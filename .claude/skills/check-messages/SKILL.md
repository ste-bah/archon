---
name: check-messages
description: Check RocketChat for new messages since last read. Shows unread messages, silent when none. Writes last-read timestamp to track state (intentionally stateful — this is a polling skill, not a read-only query).
---

# Check Messages — RocketChat Polling

Check RocketChat channels for new messages since the last time you checked.

NOTE: This skill intentionally writes to `.persistent-memory/rocketchat-last-read.json` to track read state. This is an exception to the read-only skill convention because message polling is inherently stateful.

## What to do

### 1. Read last-read state

Read `.persistent-memory/rocketchat-last-read.json`. Format:
```json
{
  "A.I.-Chat": "2026-03-23T18:44:02.065Z"
}
```

If the file doesn't exist (first run), use a timestamp from 1 hour ago as the cutoff. Do NOT dump the entire message history.

### 2. Check each channel

For each channel in the config (start with `A.I.-Chat`):

Call `mcp__rocketchat__read_messages` with:
- `channel`: the channel name
- `limit`: 50

### 3. Filter new messages

From the returned messages:
- Keep only messages with timestamp NEWER than the last-read timestamp for that channel
- Filter out messages where `username` matches your own username (you are "archon")
- Sort remaining by timestamp ascending (oldest first)

### 4. Display results

**If new messages found:**
```
[RocketChat] N new messages in A.I.-Chat:
  Stevenbahia (2m ago): Hello there it worked
  gemini (1m ago): I'm ready to collaborate on the task
```

Show relative timestamps (Xm ago, Xh ago). Truncate long messages to 200 chars.

**If limit was saturated (50 messages returned and ALL are newer than last-read):**
Add: "(50+ messages — showing most recent 50)"

**If no new messages:** Say nothing. Produce no output. Complete silently.

**On error (MCP not connected, channel not found, etc.):**
```
[RocketChat] Could not check messages: [brief reason]
```

### 5. Update last-read timestamp

Set the last-read timestamp for each checked channel to the newest message's timestamp (whether it was from you or someone else — you've "seen" them all).

Write updated state to `.persistent-memory/rocketchat-last-read.json`.

### 6. Respond to messages if appropriate

If any new messages appear to be directed at you or require a response (questions, requests, greetings), respond via `mcp__rocketchat__send_message`. Use your judgment — not every message needs a reply.

## Configuration

Channels to check: `A.I.-Chat`

To add more channels, add them to the check list in this skill. Each channel gets its own last-read timestamp.

## Rules

- SILENT when no new messages — do not say "no new messages"
- Do NOT store messages as MemoryGraph memories (would flood the graph)
- Do NOT modify CLAUDE.md
- Keep display concise — this runs frequently during /loop
- Filter out your own messages (username: archon)
