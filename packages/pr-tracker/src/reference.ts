const urlPattern = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/g

export type Reference = { provider: "github" | "gitlab"; value?: string; repository?: string }

const mrUrlPattern = /^https?:\/\/[^\s/]+\/(?:[^\s/]+\/)+-\/merge_requests\/[1-9]\d*$/

// Parse only literal shell words. Skip substitutions, redirects, and other syntax
// rather than guess which executable, host, or MR the shell would select.
function shellCommands(command: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word: string | undefined
  let quote: string | undefined
  const endWord = () => {
    if (word !== undefined) words.push(word)
    word = undefined
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
      else word = (word ?? "") + character
      continue
    }
    if (character === "$" || character === "`") return []
    if (character === "\\") {
      const next = command[++index]
      if (next === undefined) return []
      if (next !== "\n") word = (word ?? "") + next
      continue
    }
    if (quote) {
      if (character === quote) quote = undefined
      else word = (word ?? "") + character
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
    else word = (word ?? "") + character
  }
  if (quote) return []
  endCommand()
  return commands
}

function updateReference(args: string[]): Reference | undefined {
  const valueFlags = new Set(["--repo", "-R", "--title", "-t", "--description", "-d", "--description-file",
    "--assignee", "-a", "--attach", "--label", "-l", "--milestone", "-m", "--reviewer", "--target-branch", "--unlabel", "-u"])
  const booleanFlags = new Set(["--draft", "--fill", "-f", "--fill-commit-body", "--lock-discussion", "--ready", "-r",
    "--remove-source-branch", "--squash-before-merge", "--unassign", "--unlock-discussion", "--wip", "--yes", "-y"])
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
    /(?:^|\/)glab$/.test(words[0] ?? "") && words[1] === "mr" && ["create", "update"].includes(words[2] ?? ""),
  )
  if (operations.length !== 1 || operations[0] !== commands.at(-1)) return github
  const operation = operations[0]!
  const args = operation.slice(3)
  if (args.some((arg) => ["--dry-run", "--web", "-w", "--help", "-h"].includes(arg.split("=")[0]!))) return github

  const lines = typeof output === "string" ? output.split(/\r?\n/).filter((line) => line !== "") : []
  if (args.includes("--auto-merge") && lines.at(-1) === "✓ Auto-merge enabled. Will merge when all checks pass.") lines.pop()
  const result = lines.at(-1)
  if (result && mrUrlPattern.test(result)) return [...github, { provider: "gitlab", value: result }]

  // With no result output, only a fully parsed update target is safe to recover.
  if (operation[2] !== "update" || lines.length > 0 || commands.length !== 1) return github
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
