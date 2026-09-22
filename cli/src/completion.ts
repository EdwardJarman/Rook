/**
 * `rook completion <shell>`: static shell completions generated from the
 * single source of truth (COMMANDS + KNOWN_FLAGS in args.ts), so new
 * commands and flags complete without touching three scripts.
 */

import { COMMANDS, KNOWN_FLAGS } from "./args.js";

export type CompletionShell = "bash" | "zsh" | "powershell";

const commands = [...COMMANDS].join(" ");
const flags = [...KNOWN_FLAGS].join(" ");

const BASH = `# rook completion (bash) — install with:
#   rook completion bash >> ~/.bashrc
_rook() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "${flags}" -- "$cur"))
    return
  fi
  COMPREPLY=($(compgen -W "${commands}" -- "$cur"))
}
complete -F _rook rook
`;

const ZSH = `#compdef rook
# rook completion (zsh) — install with:
#   rook completion zsh > ~/.zsh/completions/_rook  (then compinit)
_rook() {
  if [[ "$PREFIX" == -* ]]; then
    compadd ${KNOWN_FLAGS.map((flag) => `"${flag}"`).join(" ")}
    return
  fi
  compadd ${[...COMMANDS].map((cmd) => `"${cmd}"`).join(" ")}
}
compdef _rook rook
`;

const POWERSHELL = `# rook completion (PowerShell) — install with:
#   rook completion powershell | Out-String | Invoke-Expression  (in $PROFILE)
Register-ArgumentCompleter -Native -CommandName rook -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = @(${[...COMMANDS, ...KNOWN_FLAGS].map((word) => `'${word}'`).join(", ")})
  $words | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;

/** Render a completion script, or undefined for an unknown shell. Pure. */
export function renderCompletion(shell: string | undefined): string | undefined {
  switch ((shell ?? "").trim().toLowerCase()) {
    case "bash":
      return BASH;
    case "zsh":
      return ZSH;
    case "powershell":
    case "pwsh":
      return POWERSHELL;
    default:
      return undefined;
  }
}
