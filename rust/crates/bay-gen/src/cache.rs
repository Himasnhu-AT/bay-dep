use std::{
    fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::{GeneratedAsset, Provenance, generation::GenError};

fn cache_dir() -> Result<PathBuf, GenError> {
    bay_paths::data_dir()
        .map(|path| path.join("generation").join("receipts"))
        .ok_or_else(|| GenError::Receipt("bay could not resolve its data directory".into()))
}

pub(crate) fn load(request_hash: &str) -> Result<Option<GeneratedAsset>, GenError> {
    let path = cache_dir()?.join(format!("{request_hash}.json"));
    if !path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|error| {
        GenError::Receipt(format!("could not read {}: {error}", path.display()))
    })?;
    let asset = serde_json::from_slice(&bytes).map_err(|error| {
        GenError::Receipt(format!(
            "could not parse cached receipt {}: {error}",
            path.display()
        ))
    })?;
    Ok(Some(asset))
}

pub(crate) fn save(asset: &GeneratedAsset) -> Result<(), GenError> {
    let directory = cache_dir()?;
    fs::create_dir_all(&directory).map_err(|error| {
        GenError::Receipt(format!(
            "could not create generation receipt directory {}: {error}",
            directory.display()
        ))
    })?;
    let path = directory.join(format!("{}.json", asset.provenance.request_hash));
    let temporary = path.with_extension("json.tmp");
    let bytes =
        serde_json::to_vec_pretty(asset).map_err(|error| GenError::Receipt(error.to_string()))?;
    fs::write(&temporary, bytes).map_err(|error| {
        GenError::Receipt(format!("could not write {}: {error}", temporary.display()))
    })?;
    fs::rename(&temporary, &path).map_err(|error| {
        GenError::Receipt(format!(
            "could not publish generation receipt {}: {error}",
            path.display()
        ))
    })
}

pub(crate) fn verify_provenance(request_hash: &str, path: &Path) -> Result<Provenance, GenError> {
    let asset = load(request_hash)?.ok_or_else(|| {
        GenError::Receipt(format!(
            "no generation receipt {request_hash:?} exists on this machine"
        ))
    })?;
    let expected = fs::canonicalize(&asset.path).map_err(|error| {
        GenError::Receipt(format!(
            "could not resolve receipt artifact {}: {error}",
            asset.path.display()
        ))
    })?;
    let supplied = fs::canonicalize(path).map_err(|error| {
        GenError::Receipt(format!(
            "could not resolve imported artifact {}: {error}",
            path.display()
        ))
    })?;
    if expected != supplied {
        return Err(GenError::Receipt(
            "the generation receipt belongs to a different artifact path".into(),
        ));
    }
    let bytes = fs::read(&supplied).map_err(|error| {
        GenError::Receipt(format!("could not read {}: {error}", supplied.display()))
    })?;
    let measured = format!("{:x}", Sha256::digest(bytes));
    if measured != asset.provenance.artifact_sha256 {
        return Err(GenError::Receipt(
            "the generated artifact changed after its quality gate; generate or verify it again"
                .into(),
        ));
    }
    Ok(asset.provenance)
}
