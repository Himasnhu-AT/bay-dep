//! Unpacking a verified archive onto disk.
//!
//! Two shapes, because the artifacts have two shapes: pull named members out to fixed paths
//! (ffmpeg, ffprobe, uv), or unpack a whole tree into one directory (CPython).
//!
//! **Nothing is written where it was asked to be written until it is complete.** A file lands
//! at `<name>.<pid>.part` and is renamed; a tree is built in a sibling directory and renamed
//! over. An interrupted extraction therefore leaves either the old state or the new one, never
//! a half-written `bin/ffmpeg` that is executable, on `PATH`, and truncated.
//!
//! **Every destination is re-checked against the root.** The manifest is trusted enough to be
//! compiled in, but archive member names are not — a member called `../../.zshrc` is the
//! classic zip-slip, and a tarball is no safer. [`resolve_inside`] is a pure function so the
//! escape attempts are unit-tested rather than assumed.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use crate::ProvisionError;
use crate::manifest::{FileInstall, Format, Tree};

/// Join `relative` onto `root`, refusing anything that would land outside it.
///
/// Rejects absolute paths, drive letters and `..` by inspecting components rather than by
/// string matching — `a/../../b` contains no leading `..` and still escapes.
pub fn resolve_inside(root: &Path, relative: &str) -> Option<PathBuf> {
    let mut resolved = root.to_path_buf();
    let mut depth = 0i32;
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => {
                resolved.push(part);
                depth += 1;
            }
            Component::CurDir => {}
            // A parent that stays within the subtree is harmless, but one that unwinds past
            // the root is not — track the depth rather than banning `..` outright.
            Component::ParentDir => {
                depth -= 1;
                if depth < 0 {
                    return None;
                }
                resolved.pop();
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(resolved)
}

/// Drop `count` leading components from an archive member's path.
///
/// Returns `None` for a member that is entirely consumed — the wrapper directory itself, which
/// has nothing to unpack.
fn strip_components(name: &str, count: usize) -> Option<String> {
    let rest: Vec<&str> = name
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .skip(count)
        .collect();
    if rest.is_empty() {
        None
    } else {
        Some(rest.join("/"))
    }
}

/// Open a verified archive, naming the path in any failure.
///
/// zip needs random access and tar is sequential, so rather than force one shape on both, each
/// extraction function walks its own format; only the opening is shared.
fn reader_for(path: &Path) -> Result<File, ProvisionError> {
    File::open(path).map_err(|e| ProvisionError::at(path, e))
}

/// Pull named members out of `archive` and install them under `root`.
///
/// A member named in the manifest but absent from the archive is an error, not a skip: it means
/// the publisher changed their layout, and silently installing nothing would leave bay looking
/// for an ffmpeg that was never written.
pub fn extract_files(
    archive: &Path,
    format: Format,
    files: &[FileInstall],
    root: &Path,
) -> Result<Vec<PathBuf>, ProvisionError> {
    let mut wanted: Vec<(&FileInstall, PathBuf)> = Vec::new();
    for file in files {
        let destination =
            resolve_inside(root, &file.install).ok_or_else(|| ProvisionError::UnsafePath {
                member: file.install.clone(),
            })?;
        wanted.push((file, destination));
    }

    let mut found: Vec<PathBuf> = Vec::new();
    match format {
        Format::Zip => {
            let mut zip = zip::ZipArchive::new(reader_for(archive)?)
                .map_err(|e| ProvisionError::Archive(e.to_string()))?;
            for index in 0..zip.len() {
                let mut member = zip
                    .by_index(index)
                    .map_err(|e| ProvisionError::Archive(e.to_string()))?;
                let name = member.name().to_string();
                let Some((file, destination)) = wanted.iter().find(|(f, _)| f.member == name)
                else {
                    continue;
                };
                write_atomically(destination, &mut member, file.executable)?;
                found.push(destination.clone());
            }
        }
        Format::TarGz | Format::Auto => {
            let decoder = flate2::read::GzDecoder::new(reader_for(archive)?);
            let mut tar = tar::Archive::new(decoder);
            for entry in tar
                .entries()
                .map_err(|e| ProvisionError::Archive(e.to_string()))?
            {
                let mut entry = entry.map_err(|e| ProvisionError::Archive(e.to_string()))?;
                let name = entry
                    .path()
                    .map_err(|e| ProvisionError::Archive(e.to_string()))?
                    .to_string_lossy()
                    .replace('\\', "/");
                let Some((file, destination)) = wanted.iter().find(|(f, _)| f.member == name)
                else {
                    continue;
                };
                write_atomically(destination, &mut entry, file.executable)?;
                found.push(destination.clone());
            }
        }
    }

    for (file, destination) in &wanted {
        if !found.contains(destination) {
            return Err(ProvisionError::MissingMember {
                member: file.member.clone(),
                archive: archive.display().to_string(),
            });
        }
    }
    Ok(found)
}

/// Unpack the whole of `archive` into `root/tree.into`, dropping `tree.strip` leading
/// components.
///
/// Built beside the destination and renamed over it, so an interrupted unpack cannot leave a
/// Python tree that exists, satisfies the "is it installed" probe, and is missing half its
/// standard library.
pub fn extract_tree(
    archive: &Path,
    format: Format,
    tree: &Tree,
    root: &Path,
) -> Result<PathBuf, ProvisionError> {
    let destination =
        resolve_inside(root, &tree.into).ok_or_else(|| ProvisionError::UnsafePath {
            member: tree.into.clone(),
        })?;
    let staging = destination.with_file_name(format!(
        "{}.{}.partial",
        destination
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "tree".into()),
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| ProvisionError::at(&staging, e))?;

    let unpack = || -> Result<(), ProvisionError> {
        match format {
            Format::Zip => {
                let mut zip = zip::ZipArchive::new(reader_for(archive)?)
                    .map_err(|e| ProvisionError::Archive(e.to_string()))?;
                for index in 0..zip.len() {
                    let mut member = zip
                        .by_index(index)
                        .map_err(|e| ProvisionError::Archive(e.to_string()))?;
                    let name = member.name().to_string();
                    let Some(relative) = strip_components(&name, tree.strip) else {
                        continue;
                    };
                    let target = resolve_inside(&staging, &relative)
                        .ok_or(ProvisionError::UnsafePath { member: name })?;
                    if member.is_dir() {
                        fs::create_dir_all(&target).map_err(|e| ProvisionError::at(&target, e))?;
                        continue;
                    }
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).map_err(|e| ProvisionError::at(parent, e))?;
                    }
                    let executable = member.unix_mode().is_some_and(|mode| mode & 0o111 != 0);
                    let mut out =
                        File::create(&target).map_err(|e| ProvisionError::at(&target, e))?;
                    io::copy(&mut member, &mut out).map_err(|e| ProvisionError::at(&target, e))?;
                    if executable {
                        set_executable(&target)?;
                    }
                }
            }
            Format::TarGz | Format::Auto => {
                let decoder = flate2::read::GzDecoder::new(reader_for(archive)?);
                let mut tar = tar::Archive::new(decoder);
                // Ownership from the tarball is meaningless here — these files belong to the
                // user running bay, and honouring recorded uids would fail without root.
                tar.set_preserve_permissions(true);
                tar.set_unpack_xattrs(false);
                for entry in tar
                    .entries()
                    .map_err(|e| ProvisionError::Archive(e.to_string()))?
                {
                    let mut entry = entry.map_err(|e| ProvisionError::Archive(e.to_string()))?;
                    let name = entry
                        .path()
                        .map_err(|e| ProvisionError::Archive(e.to_string()))?
                        .to_string_lossy()
                        .replace('\\', "/");
                    let Some(relative) = strip_components(&name, tree.strip) else {
                        continue;
                    };
                    let target = resolve_inside(&staging, &relative)
                        .ok_or(ProvisionError::UnsafePath { member: name })?;
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).map_err(|e| ProvisionError::at(parent, e))?;
                    }
                    // `unpack` handles regular files, directories and symlinks, and refuses to
                    // follow a symlink out of the destination.
                    entry
                        .unpack(&target)
                        .map_err(|e| ProvisionError::at(&target, e))?;
                }
            }
        }
        Ok(())
    };

    if let Err(error) = unpack() {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| ProvisionError::at(parent, e))?;
    }
    // Replacing an existing tree: remove then rename. Not atomic, but the alternative — renaming
    // the old one aside first — leaves a directory nobody will ever clean up if bay is killed
    // between the two renames.
    let _ = fs::remove_dir_all(&destination);
    fs::rename(&staging, &destination).map_err(|e| ProvisionError::at(&destination, e))?;
    strip_quarantine(&destination);
    Ok(destination)
}

/// Write a member to `destination` via a `.part` file, then rename.
fn write_atomically(
    destination: &Path,
    source: &mut dyn Read,
    executable: bool,
) -> Result<(), ProvisionError> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| ProvisionError::at(parent, e))?;
    }
    let staging = destination.with_extension(format!("{}.part", std::process::id()));
    let result = (|| -> Result<(), ProvisionError> {
        let mut out = File::create(&staging).map_err(|e| ProvisionError::at(&staging, e))?;
        io::copy(source, &mut out).map_err(|e| ProvisionError::at(&staging, e))?;
        out.sync_all()
            .map_err(|e| ProvisionError::at(&staging, e))?;
        if executable {
            set_executable(&staging)?;
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&staging);
        return Err(error);
    }
    fs::rename(&staging, destination).map_err(|e| ProvisionError::at(destination, e))?;
    strip_quarantine(destination);
    Ok(())
}

fn set_executable(path: &Path) -> Result<(), ProvisionError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|e| ProvisionError::at(path, e))?
            .permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(path, permissions).map_err(|e| ProvisionError::at(path, e))?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

/// Remove `com.apple.quarantine`, which stops a downloaded executable from running.
///
/// bay writes these files itself, so in the common case there is no attribute to remove — but
/// an app that is itself quarantined can propagate it, and the failure that produces ("ffmpeg
/// cannot be opened because the developer cannot be verified") is opaque. Best-effort: a
/// missing attribute, a missing `xattr` and a non-macOS host are all fine.
///
/// `/usr/bin/xattr` is an absolute path to a system binary and is passed no user-controlled
/// argument beyond a path bay itself constructed — this does not reintroduce the shell
/// execution [`bay_paths::tools`] deliberately refuses.
fn strip_quarantine(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("/usr/bin/xattr")
            .args(["-r", "-d", "com.apple.quarantine"])
            .arg(path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bay-archive-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Build a tar.gz in memory from `(name, contents)` pairs.
    fn tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        for (name, contents) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, *contents).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    /// A tarball with a member name the `tar` crate refuses to write through its builder.
    ///
    /// Hand-rolled on purpose: `tar::Builder` rejects `..` in a path, so the only way to test
    /// that bay refuses a hostile archive is to produce one the way an attacker would — by
    /// writing the 512-byte ustar header directly.
    fn malicious_tar_gz(name: &str, contents: &[u8]) -> Vec<u8> {
        use std::io::Write;
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        let put = |header: &mut [u8; 512], at: usize, text: &str| {
            header[at..at + text.len()].copy_from_slice(text.as_bytes());
        };
        put(&mut header, 100, "0000644\0"); // mode
        put(&mut header, 108, "0000000\0"); // uid
        put(&mut header, 116, "0000000\0"); // gid
        put(&mut header, 124, &format!("{:011o}\0", contents.len()));
        put(&mut header, 136, "00000000000\0"); // mtime
        header[148..156].fill(b' '); // checksum field is spaces while summing
        header[156] = b'0'; // regular file
        put(&mut header, 257, "ustar\0");
        put(&mut header, 263, "00");
        let checksum: u32 = header.iter().map(|b| u32::from(*b)).sum();
        put(&mut header, 148, &format!("{checksum:06o}\0 "));

        let mut tar = Vec::new();
        tar.extend_from_slice(&header);
        tar.extend_from_slice(contents);
        tar.resize(tar.len().div_ceil(512) * 512, 0);
        tar.extend_from_slice(&[0u8; 1024]); // end-of-archive

        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&tar).unwrap();
        encoder.finish().unwrap()
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(io::Cursor::new(Vec::new()));
        let options: zip::write::FileOptions<()> =
            zip::write::FileOptions::default().unix_permissions(0o755);
        for (name, contents) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(contents).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn file_install(member: &str, install: &str) -> FileInstall {
        FileInstall {
            member: member.into(),
            install: install.into(),
            executable: true,
        }
    }

    #[test]
    fn a_named_member_is_pulled_out_of_a_zip() {
        let dir = temp_dir("zip-files");
        let archive = dir.join("a.zip");
        fs::write(&archive, zip_of(&[("ffmpeg", b"binary bytes")])).unwrap();
        let root = dir.join("runtime");
        extract_files(
            &archive,
            Format::Zip,
            &[file_install("ffmpeg", "bin/ffmpeg")],
            &root,
        )
        .expect("extraction");
        assert_eq!(fs::read(root.join("bin/ffmpeg")).unwrap(), b"binary bytes");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_nested_member_is_pulled_out_of_a_tarball() {
        let dir = temp_dir("tar-files");
        let archive = dir.join("a.tar.gz");
        fs::write(
            &archive,
            tar_gz(&[("uv-aarch64-apple-darwin/uv", b"uv bytes")]),
        )
        .unwrap();
        let root = dir.join("runtime");
        extract_files(
            &archive,
            Format::TarGz,
            &[file_install("uv-aarch64-apple-darwin/uv", "bin/uv")],
            &root,
        )
        .expect("extraction");
        assert_eq!(fs::read(root.join("bin/uv")).unwrap(), b"uv bytes");
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn an_extracted_tool_is_executable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("exec");
        let archive = dir.join("a.zip");
        fs::write(&archive, zip_of(&[("ffmpeg", b"x")])).unwrap();
        let root = dir.join("runtime");
        extract_files(
            &archive,
            Format::Zip,
            &[file_install("ffmpeg", "bin/ffmpeg")],
            &root,
        )
        .unwrap();
        let mode = fs::metadata(root.join("bin/ffmpeg"))
            .unwrap()
            .permissions()
            .mode();
        assert!(mode & 0o111 != 0, "mode {mode:o}");
        fs::remove_dir_all(&dir).ok();
    }

    /// A publisher who renames a member must produce a loud failure, not an install that
    /// "succeeds" and writes nothing.
    #[test]
    fn a_member_the_archive_does_not_contain_is_an_error() {
        let dir = temp_dir("missing-member");
        let archive = dir.join("a.zip");
        fs::write(&archive, zip_of(&[("something-else", b"x")])).unwrap();
        let error = extract_files(
            &archive,
            Format::Zip,
            &[file_install("ffmpeg", "bin/ffmpeg")],
            &dir.join("runtime"),
        )
        .expect_err("a renamed member must fail loudly");
        assert!(
            matches!(error, ProvisionError::MissingMember { .. }),
            "{error}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_tree_is_unpacked_with_its_wrapper_directory_stripped() {
        let dir = temp_dir("tree");
        let archive = dir.join("py.tar.gz");
        fs::write(
            &archive,
            tar_gz(&[
                ("python/bin/python3.12", b"interpreter"),
                ("python/lib/os.py", b"stdlib"),
            ]),
        )
        .unwrap();
        let root = dir.join("runtime");
        let tree = Tree {
            strip: 1,
            into: "python/3.12.13".into(),
        };
        extract_tree(&archive, Format::TarGz, &tree, &root).expect("unpack");
        assert_eq!(
            fs::read(root.join("python/3.12.13/bin/python3.12")).unwrap(),
            b"interpreter"
        );
        assert!(root.join("python/3.12.13/lib/os.py").is_file());
        fs::remove_dir_all(&dir).ok();
    }

    /// Re-installing over an existing tree must replace it, not merge into it — a stale file
    /// from an older Python would otherwise survive forever.
    #[test]
    fn unpacking_a_tree_twice_replaces_it() {
        let dir = temp_dir("tree-twice");
        let root = dir.join("runtime");
        let tree = Tree {
            strip: 1,
            into: "python/3.12.13".into(),
        };
        let first = dir.join("first.tar.gz");
        fs::write(&first, tar_gz(&[("python/stale.py", b"old")])).unwrap();
        extract_tree(&first, Format::TarGz, &tree, &root).unwrap();
        let second = dir.join("second.tar.gz");
        fs::write(&second, tar_gz(&[("python/fresh.py", b"new")])).unwrap();
        extract_tree(&second, Format::TarGz, &tree, &root).unwrap();
        assert!(root.join("python/3.12.13/fresh.py").is_file());
        assert!(
            !root.join("python/3.12.13/stale.py").exists(),
            "the previous tree must be gone"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Zip-slip, on both formats. A member that climbs out of the root must be refused rather
    /// than overwriting something in the user's home directory.
    #[test]
    fn a_member_that_climbs_out_of_the_root_is_refused() {
        let dir = temp_dir("slip");
        let root = dir.join("runtime");
        let tree = Tree {
            strip: 0,
            into: "tree".into(),
        };
        for (label, bytes, format) in [
            (
                "zip",
                zip_of(&[("../../escaped.txt", b"pwned")]),
                Format::Zip,
            ),
            (
                "tar",
                malicious_tar_gz("../../escaped.txt", b"pwned"),
                Format::TarGz,
            ),
        ] {
            let archive = dir.join(format!("{label}.bin"));
            fs::write(&archive, bytes).unwrap();
            let error = extract_tree(&archive, format, &tree, &root)
                .expect_err("{label}: an escaping member must be refused");
            assert!(
                matches!(error, ProvisionError::UnsafePath { .. }),
                "{error}"
            );
        }
        assert!(
            !dir.join("escaped.txt").exists(),
            "nothing may be written outside the root"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_inside_rejects_every_way_out() {
        let root = Path::new("/runtime");
        assert_eq!(
            resolve_inside(root, "bin/ffmpeg"),
            Some(PathBuf::from("/runtime/bin/ffmpeg"))
        );
        // A `..` that stays inside is fine.
        assert_eq!(
            resolve_inside(root, "bin/../lib/x"),
            Some(PathBuf::from("/runtime/lib/x"))
        );
        for escape in [
            "../outside",
            "a/../../outside",
            "/etc/passwd",
            "bin/../../../../../../etc/passwd",
        ] {
            assert_eq!(
                resolve_inside(root, escape),
                None,
                "{escape} must be refused"
            );
        }
    }

    #[test]
    fn strip_components_drops_the_wrapper_and_skips_it() {
        assert_eq!(
            strip_components("python/bin/x", 1),
            Some("bin/x".to_string())
        );
        assert_eq!(strip_components("python/", 1), None);
        assert_eq!(strip_components("a/b/c", 0), Some("a/b/c".to_string()));
    }
}
