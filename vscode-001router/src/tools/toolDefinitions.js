"use strict";

const ALL_TOOLS = Object.freeze([
  {
    type: "function",
    category: "read",
    readOnly: true,
    function: {
      name: "list_files",
      description: "List files and directories inside the opened project folder (or a subdirectory). Use to explore project architecture.",
      parameters: {
        type: "object",
        properties: {
          dir: { type: "string", description: "Relative directory path inside workspace (default '.')." },
          pattern: { type: "string", description: "Optional case-insensitive path/filename filter." },
          max_results: { type: "integer", description: "Max files to return (default 100, max 300)." }
        }
      }
    }
  },
  {
    type: "function",
    category: "read",
    readOnly: true,
    function: {
      name: "read_file",
      description: "Read the contents of a text file with 1-based line numbers.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative workspace path or absolute path (if outside-workspace access is granted)." },
          start_line: { type: "integer", description: "Optional 1-based start line." },
          end_line: { type: "integer", description: "Optional 1-based inclusive end line." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    category: "search",
    readOnly: true,
    function: {
      name: "search_files",
      description: "Search for a text or regex pattern across source files in the workspace and return file paths, line numbers, and matching lines.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search string or regex pattern." },
          dir: { type: "string", description: "Optional relative subdirectory to restrict the search." },
          is_regex: { type: "boolean", description: "Set true to treat query as a regular expression." },
          max_matches: { type: "integer", description: "Maximum matches to return (default 40, max 120)." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    category: "edit",
    readOnly: false,
    function: {
      name: "write_to_file",
      description: "Create a new file or overwrite an existing file with complete contents. Parent directories are created automatically.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative or absolute path of the file to create or overwrite." },
          content: { type: "string", description: "Full complete file contents." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    category: "edit",
    readOnly: false,
    function: {
      name: "replace_in_file",
      description: "Make targeted search-and-replace edits inside an existing file without rewriting the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to edit." },
          search: { type: "string", description: "Exact existing text block to locate." },
          replace: { type: "string", description: "Replacement text block." },
          replace_all: { type: "boolean", description: "Replace all occurrences (default false — replaces first exact match)." }
        },
        required: ["path", "search", "replace"]
      }
    }
  },
  {
    type: "function",
    category: "delete",
    readOnly: false,
    function: {
      name: "delete_file",
      description: "Delete a file from disk.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to delete." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    category: "terminal",
    readOnly: false,
    function: {
      name: "execute_command",
      description: "Execute a shell/terminal command (PowerShell/cmd/bash) in the workspace and stream live stdout/stderr output and exit code.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Exact shell command to execute." },
          cwd: { type: "string", description: "Optional working directory relative to workspace or absolute path." },
          timeout_ms: { type: "integer", description: "Optional timeout in milliseconds (default 120000)." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    category: "ide",
    readOnly: true,
    function: {
      name: "get_diagnostics",
      description: "Read live errors and warnings from the VS Code Problems panel for a specific file or across the entire workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative file path; omit to inspect all files with diagnostics." }
        }
      }
    }
  },
  {
    type: "function",
    category: "git",
    readOnly: true,
    function: {
      name: "git_info",
      description: "Inspect repository git status, diff summary, or recent commit log.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["status", "diff", "log"],
            description: "Git query to run: status, diff, or log (default status)."
          },
          path: { type: "string", description: "Optional relative file path for diff/log." }
        }
      }
    }
  },
  {
    type: "function",
    category: "web",
    readOnly: true,
    function: {
      name: "web_fetch",
      description: "Fetch text, JSON, documentation, or raw GitHub files from an HTTP/HTTPS URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "HTTP or HTTPS URL to fetch." },
          max_chars: { type: "integer", description: "Max characters to return (default 18000)." }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    category: "ide",
    readOnly: true,
    function: {
      name: "open_file",
      description: "Open a file inside the VS Code editor and optionally jump to a specific 1-based line number.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to open." },
          line: { type: "integer", description: "Optional 1-based line number to reveal." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    category: "plan",
    readOnly: true,
    function: {
      name: "update_plan",
      description: "Update the visible task checklist/plan shown to the developer in the chat UI as you progress through multi-step work.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "done", "failed"] }
              },
              required: ["title", "status"]
            }
          }
        },
        required: ["steps"]
      }
    }
  }
]);

const TOOL_ALIASES = Object.freeze({
  list_workspace_files: "list_files",
  read_workspace_file: "read_file",
  search_workspace_text: "search_files",
  run_command: "execute_command",
  run_terminal_command: "execute_command"
});

const KNOWN_TOOL_NAMES = new Set([
  ...ALL_TOOLS.map((t) => t.function.name),
  ...Object.keys(TOOL_ALIASES)
]);

function getToolsForMode(mode, permissions) {
  const isReadOnlyMode = mode === "ask" || mode === "plan";
  return ALL_TOOLS.filter((t) => {
    if (isReadOnlyMode && !t.readOnly) return false;
    if (t.function.name === "web_fetch" && permissions?.webAccess === false && permissions?.preset !== "ask") {
      // Still expose web_fetch if preset is "ask" so user can approve on demand; only hide if explicitly unusable
    }
    return true;
  }).map(({ type, function: fn }) => ({ type, function: fn }));
}

module.exports = {
  ALL_TOOLS,
  TOOL_ALIASES,
  KNOWN_TOOL_NAMES,
  getToolsForMode
};
