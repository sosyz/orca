export function formatJavaArgumentFile(argumentsList) {
  return `${argumentsList.map(quoteJavaArgument).join('\n')}\n`
}

function quoteJavaArgument(value) {
  if (/\r|\n/u.test(value)) {
    throw new Error('Java argument file values must not contain newlines')
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}
