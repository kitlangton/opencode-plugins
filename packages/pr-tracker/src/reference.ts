const urlPattern = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/g

export type Reference = { provider: "github" | "gitlab"; value?: string; repository?: string }

const mrUrlPattern = /^https?:\/\/[^\s/]+\/(?:[^\s/]+\/)+-\/merge_requests\/[1-9]\d*$/

type ShellWord = { value: string; opaque: boolean }

const textFlags = new Set(["--description", "-d", "--title", "-t"])
const valueFlags = new Set(["--repo", "-R", "--title", "-t", "--description", "-d", "--description-file",
  "--assignee", "-a", "--attach", "--label", "-l", "--milestone", "-m", "--reviewer", "--target-branch", "--unlabel", "-u"])
const booleanFlags = new Set(["--draft", "--fill", "-f", "--fill-commit-body", "--lock-discussion", "--ready", "-r",
  "--remove-source-branch", "--squash-before-merge", "--unassign", "--unlock-discussion", "--wip", "--yes", "-y"])

function ansiEnd(command: string, start: number): number | undefined {
  for (let index = start + 2; index < command.length; index++) {
    if (command[index] === "\\") index++
    else if (command[index] === "'") return index
  }
  return undefined
}

// Only locate the end of a substitution; never evaluate its contents. Restrict
// heredocs to a quoted delimiter on its own line so body syntax stays opaque.
function substitutionEnd(command: string, start: number): number | undefined {
  let depth = 1
  let quote: string | undefined
  for (let index = start + 2; index < command.length; index++) {
    const character = command[index]!
    if (quote === "'") {
      if (character === quote) quote = undefined
      continue
    }
    if (character === "\\") {
      if (command[++index] === undefined) return undefined
      continue
    }
    if (!quote && command.startsWith("$'", index)) {
      const end = ansiEnd(command, index)
      if (end === undefined) return undefined
      index = end
      continue
    }
    if (character === "$" && command[index + 1] === "(") {
      const end = substitutionEnd(command, index)
      if (end === undefined) return undefined
      index = end
      continue
    }
    if (character === "`") return undefined
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') quote = character
    else if (command.startsWith("<<", index)) {
      const header = command.slice(index).match(/^<<[ \t]*(['"])([A-Za-z_]\w*)\1[ \t]*\n/)
      if (!header) return undefined
      let line = index + header[0].length
      while (true) {
        const end = command.indexOf("\n", line)
        if (end === -1) return undefined
        if (command.slice(line, end) === header[2]) {
          index = end
          break
        }
        line = end + 1
      }
    } else if (character === "#") {
      // Shell comment rules depend on token boundaries. Keep unquoted hashes
      // unsupported rather than risk hiding the substitution's real end.
      return undefined
    } else if (character === "(") depth++
    else if (character === ")" && --depth === 0) return index
  }
  return undefined
}

// Executables, actions, selectors, and flags must be literal. Quoted expansions
// and ANSI strings stay opaque and can only be accepted as text option values.
function shellCommands(command: string): ShellWord[][] {
  const commands: ShellWord[][] = []
  let words: ShellWord[] = []
  let word: string | undefined
  let opaque = false
  let quote: string | undefined
  const append = (character: string) => {
    if (!opaque) word = (word ?? "") + character
  }
  const endWord = () => {
    if (word !== undefined) words.push({ value: word, opaque })
    word = undefined
    opaque = false
  }
  const endCommand = () => {
    endWord()
    if (words.length > 0) commands.push(words)
    words = []
  }
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!
    if (quote === "'") {
      if (character === quote) quote = undefined
      else append(character)
      continue
    }
    if (character === "`") return []
    if (character === "$") {
      let end: number | undefined
      if (!quote && command[index + 1] === "'") {
        end = ansiEnd(command, index)
      } else if (quote === '"') {
        if (command[index + 1] === "(") end = substitutionEnd(command, index)
        else {
          const variable = command.slice(index).match(/^\$(?:[A-Za-z_]\w*|\{[A-Za-z_]\w*\})/)
          if (variable) end = index + variable[0].length - 1
        }
      }
      if (end === undefined) return []
      word ??= ""
      opaque = true
      index = end
      continue
    }
    if (character === "\\") {
      const next = command[++index]
      if (next === undefined) return []
      if (next !== "\n") append(next)
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else append(character)
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      word ??= ""
    } else if (/[<>()[\]{}*?~]/.test(character)) return []
    else if (character === "#" && word === undefined) {
      while (index < command.length && command[index] !== "\n") index++
      endCommand()
    } else if (character === "&" && command[index + 1] === "&") {
      index++
      endCommand()
    } else if (/[;&|]/.test(character)) return []
    else if (character === "\n") endCommand()
    else if (/\s/.test(character)) endWord()
    else append(character)
  }
  if (quote) return []
  endCommand()
  return commands
}

function textArguments(args: ShellWord[]): boolean {
  if (!args.some((word) => word.opaque)) return true
  // Parse option arity so a text flag used as another option's value cannot
  // accidentally authorize an opaque selector or flag. Unknown flags fail closed.
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    const [flag, inline] = argument.value.split(/=(.*)/s)
    if (argument.opaque) {
      if (!textFlags.has(flag!) || inline === undefined) return false
      continue
    }
    if (!argument.value.startsWith("-")) continue
    if (booleanFlags.has(flag!) || flag === "--auto-merge") continue
    if (!valueFlags.has(flag!) && flag !== "--source-branch") return false
    if (inline !== undefined) continue
    const option = args[++index]
    if (!option || (option.opaque && !textFlags.has(flag!))) return false
  }
  return true
}

function updateReference(args: string[]): Reference | undefined {
  let value: string | undefined
  let repository: string | undefined
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!
    if (!argument.startsWith("-")) {
      if (value !== undefined) return undefined
      value = argument.replace(/^!(?=\d+$)/, "")
      continue
    }
    const [flag, inline] = argument.split(/=(.*)/s)
    if (booleanFlags.has(flag!)) continue
    if (!valueFlags.has(flag!)) return undefined
    const option = inline ?? args[++index]
    if (option === undefined) return undefined
    if (flag === "--repo" || flag === "-R") repository = option
  }
  return { provider: "gitlab", value, repository }
}

export function requestReferences(command: unknown, output: unknown): Reference[] {
  const github = prReferences(command, output).map((value): Reference => ({ provider: "github", value }))
  if (typeof command !== "string") return github
  const commands = shellCommands(command)
  const operations = commands.filter((words) =>
    words.slice(0, 3).every((word) => !word.opaque) &&
    /(?:^|\/)glab$/.test(words[0]?.value ?? "") && words[1]?.value === "mr" && ["create", "update"].includes(words[2]?.value ?? ""),
  )
  if (operations.length !== 1 || operations[0] !== commands.at(-1)) return github
  const operation = operations[0]!
  if (commands.slice(0, -1).some((words) => words.some((word) => word.opaque))) return github
  const arguments_ = operation.slice(3)
  if (!textArguments(arguments_)) return github
  const args = arguments_.map((word) => word.value)
  if (args.some((arg) => ["--dry-run", "--web", "-w", "--help", "-h"].includes(arg.split("=")[0]!))) return github

  const lines = typeof output === "string" ? output.split(/\r?\n/).filter((line) => line !== "") : []
  if (args.includes("--auto-merge") && lines.at(-1) === "✓ Auto-merge enabled. Will merge when all checks pass.") lines.pop()
  const result = lines.at(-1)
  if (result && mrUrlPattern.test(result)) return [...github, { provider: "gitlab", value: result }]

  // With no result output, only a fully parsed update target is safe to recover.
  if (operation[2]?.value !== "update" || lines.length > 0 || commands.length !== 1 || arguments_.some((word) => word.opaque)) return github
  const reference = updateReference(args)
  return reference ? [...github, reference] : github
}

export function prReferences(command: unknown, output: unknown): Array<string | undefined> {
  if (typeof command !== "string") return []
  const urls =
    /\bgh\s+pr\s+(?:create|edit)\b/.test(command) && typeof output === "string"
      ? [...output.matchAll(urlPattern)].map((match) => match[0])
      : []
  if (urls.length > 0) return [...new Set(urls)]

  const edit = command.match(/\bgh\s+pr\s+edit\s+(https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+|\d+)\b/)
  if (edit?.[1]) return [edit[1]]
  if (/\bgh\s+pr\s+edit\b/.test(command)) return [undefined]

  if (!/\bgh\s+api\b/.test(command)) return []
  const references = new Set<string>()
  for (const match of command.matchAll(/\brepos\/([^\s/'"]+)\/([^\s/'"]+)\/pulls\/(\d+)\b/g)) {
    references.add(`https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`)
  }

  return [...references]
}
