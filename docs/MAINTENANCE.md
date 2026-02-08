# MCP Lab Maintenance Guide

**Purpose**: Quick reference for which files to update when making changes.

---

## Adding a New Agent

1. Create `/Volumes/Storage/MCP/docs/AGENTS/[agent-name]-agent.md`
2. Update `/Volumes/Storage/MCP/docs/AGENTS/INDEX.md`:
   - Increment `Total Agents` count (line ~3)
   - Add entry to Quick Reference table (line ~10-40)
   - Add detailed section in appropriate Part (1/2/3)
   - Update `Part 2/3` range if needed

---

## Adding a New MCP Server

1. Create server directory and code
2. Update `/Volumes/Storage/MCP/MCP_SERVERS_CONFIG.json`:
   - Add to `servers.v2` or `servers.floyd` or `servers.other`
   - Update `summary` counts
   - Update `validation` counts
3. Update `/Volumes/Storage/MCP/lab-lead-server/src/index.ts`:
   - Add to `LAB_KNOWLEDGE.servers` object
   - Add tools to `categories` object
   - Add to `TOOL_TO_SERVER` mapping
   - Add relevant keywords to `findToolsForTask()`
4. Update `/Volumes/Storage/MCP/MCP_TOOLS_REFERENCE.md`:
   - Add to Quick Reference table
   - Add detailed tool section
5. Rebuild lab-lead-server: `npm run build`

---

## Adding/Modifying Tools on Existing Server

1. Update server code
2. Update `/Volumes/Storage/MCP/lab-lead-server/src/index.ts`:
   - Update `tools` count in `LAB_KNOWLEDGE`
   - Update `categories` if needed
   - Update `TOOL_TO_SERVER` if new tool
3. Update `/Volumes/Storage/MCP/MCP_TOOLS_REFERENCE.md`:
   - Update tool count in server entry
   - Update tool descriptions
4. Rebuild server and lab-lead-server

---

## Removing a Server

1. Update `/Volumes/Storage/MCP/MCP_SERVERS_CONFIG.json`:
   - Remove server entry
   - Move to `removed_servers` array with reason
2. Update `/Volumes/Storage/MCP/lab-lead-server/src/index.ts`:
   - Remove from `LAB_KNOWLEDGE.servers`
   - Remove tools from `categories`
   - Remove from `TOOL_TO_SERVER`
3. Update `/Volumes/Storage/MCP/MCP_TOOLS_REFERENCE.md`
4. Rebuild lab-lead-server

---

## File Update Checklist

| Change | Files to Update |
|--------|-----------------|
| New agent | `INDEX.md`, new `*-agent.md` |
| New server | `MCP_SERVERS_CONFIG.json`, `lab-lead-server/src/index.ts`, `MCP_TOOLS_REFERENCE.md` |
| New tool | `lab-lead-server/src/index.ts`, `MCP_TOOLS_REFERENCE.md` |
| Remove server | `MCP_SERVERS_CONFIG.json`, `lab-lead-server/src/index.ts`, `MCP_TOOLS_REFERENCE.md` |
| Agent prompt change | Specific `*-agent.md` only |

---

## Build Commands

```bash
# After lab-lead changes
cd /Volumes/Storage/MCP/lab-lead-server && npm run build

# After any server changes
cd /Volumes/Storage/MCP/[server-name] && npm run build
```

---

## Current State

- **Total Servers**: 11 (4 v2, 4 floyd, 3 other)
- **Total Agents**: 31
- **Total Tools**: ~103
