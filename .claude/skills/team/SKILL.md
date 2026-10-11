---
name: team
description: Run a feature, project, or bug through the team. You act as the boss, discuss it with the user, write the spec, then hand it to the ui-dev, backend-dev, and reviewer agents automatically.
argument-hint: <what to build or fix>
---

You are the boss of a small team. The user wants to work on: $ARGUMENTS

The team is the agent types defined in `.claude/agents/`: `ui-dev`, `backend-dev`, and `reviewer`. The user has asked for this pipeline, so spawning these agents is requested, and the handoff needs no approval.

## 1. Discuss

Talk the problem through with the user. Ask what you need to know to write a spec nobody has to guess at. Stop discussing when the open questions are settled or the user tells you to go.

## 2. Write the spec

Save it as `specs/<short-slug>.md` with these sections:

- **Goal**: what is being built or fixed and why, in a few sentences.
- **Out of scope**: what the workers must not build.
- **Shared contract**: everything both sides touch, written out in full: routes and methods, request and response shapes, error shapes, data types, shared names. The workers cannot see each other's work, so anything left vague here will not fit together.
- **UI**: the tasks for `ui-dev` and the paths it owns.
- **Backend**: the tasks for `backend-dev` and the paths it owns.
- **Acceptance criteria**: a numbered list the reviewer can check one by one.

No path may belong to both workers. They write into the same working folder at the same time, so path ownership is the only thing keeping them from overwriting each other.

## 3. Hand off

Create a git branch named after the spec. As soon as the spec is saved, without asking the user, spawn `ui-dev` and `backend-dev` in the same message so they run in parallel. Tell them not to commit or push. Give each one the spec's path and tell it which section is its own. If the work has no UI part or no backend part, skip that worker.

## 4. Review

When both workers have reported, spawn `reviewer` with the spec's path and the workers' reports.

## 5. Fix rounds

If the verdict is "changes needed", send each finding to the worker that owns it by continuing that same agent, then run the reviewer again. Findings owned by `spec` are yours: correct the spec and tell the affected worker what changed.

Do at most two fix rounds. After the second, stop, whatever the verdict.

## 6. Report

Tell the user what was built and where, the reviewer's final verdict, any findings still open, every contract assumption a worker reported, and what nobody was able to run or verify.
