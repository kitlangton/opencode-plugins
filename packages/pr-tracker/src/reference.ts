const urlPattern = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/g

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
