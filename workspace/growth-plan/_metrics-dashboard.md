# Metrics dashboard — Pre-Launch

**The constraint that shapes this page:** bay ships no telemetry and the site makes no
third-party requests. That is a brand commitment worth keeping, and it means **every metric
here is first-party or manually counted.** Nothing below requires an analytics SDK.

Do not solve the measurement problem by installing a tracker. Solve it by having fewer,
better metrics and counting them by hand. At this volume, hand-counting is more accurate
than most analytics installs anyway.

---

## The five that matter

| Metric | Target by day 90 | Why it matters | Where it comes from |
|---|---|---|---|
| **Qualified waitlist signups** | 100 | The only demand signal available before a download exists. "Qualified" = they answered the one optional question, "what did you last make a video for?" An unqualified list teaches you nothing | Your own capture endpoint |
| **Interviews completed** | 15 | The stage's primary output. Ten is the minimum for patterns; fifteen gives you contradictions, which are more useful | A counter in a file |
| **Unprompted "when can I use this"** | 10 | The highest-signal number here. Nobody sends this out of politeness. If this stays at 0 while signups climb, the signups are curiosity, not demand | Inbox, GitHub issues, replies |
| **Installs by non-founders** | 10–30 | The day-90 go/no-go. Counted by hand from waitlist build requests, not inferred | Manual, from the private build handout |
| **Rendered-and-kept** | 3+ | Retention proxy with no telemetry: did they make something they did not throw away? Ask them directly | Follow-up email to installers |

---

## Supporting signals (watch, don't optimize)

| Signal | Read it as | Source |
|---|---|---|
| Site referrers | Which channel actually sends people | First-party server logs |
| GitHub stars | Weak. A vanity number that correlates with reach, not intent | GitHub |
| GitHub issues from strangers | Strong. Someone cared enough to describe a problem | GitHub |
| MCP directory click-through | Whether the highest-intent channel is real | Directory stats where offered, else referrer logs |
| Demo video completion rate | Whether the 60s cut earns the 4min cut | Platform native stats on the post |
| Post replies from the ICP | Whether build-in-public is reaching builders or just scrolling | Manual read, weekly |

---

## Metrics to explicitly ignore this quarter

| Metric | Why ignore it |
|---|---|
| Impressions, reach, follower count | Pre-PMF, reach without a conversion event is a number that only goes up and tells you nothing |
| MRR, CAC, LTV, LTV:CAC | There is no revenue and no spend. Computing these from zero is arithmetic, not insight |
| Bounce rate, session duration | Unmeasurable without a tracker, and you do not want the tracker |
| Blog traffic | Two posts is not a programme. Judge them by who they reach, not how many |
| Windows anything | The build has never been run. There is nothing to measure |

---

## The weekly review, 20 minutes, Friday

Five questions. Write the answers down, because the value is in the series, not any one week.

1. How many interviews this week, and what did someone say that surprised me?
2. Did anyone reach out unprompted? What exactly did they say they wanted?
3. Which channel sent the people who signed up? (referrer logs)
4. What did I claim publicly this week, and is it still true of the app today?
5. What is the current blocker on the day-90 go/no-go, in one sentence?

Question 4 is not optional. The brand is honesty, and honesty decays by accident when a
roadmap item slips after the post about it went out.
