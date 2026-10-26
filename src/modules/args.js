/**
 * 命令行参数解析。
 *
 * 抽成独立模块的唯一原因是可测：这几个函数决定「哪个词是检索词、哪个是开关」，
 * 判错的表现很隐蔽——命令不报错，只是老老实实查了错的东西。
 */

/**
 * 取第一个「位置参数」（子命令名、检索词、URL 等）。
 *
 * 不能直接用 `rest[0]`：`library search --text` 这种写法里 `rest[0]` 是 `--text`，
 * 于是开关被当成检索词，真的去查了一轮（实测命中 3337 条），用户还以为命令没问题。
 */
export function firstPositional(args) {
  if (!Array.isArray(args)) return undefined;
  return args.find((item) => typeof item === 'string' && item.length > 0 && !item.startsWith('-'));
}

export function hasFlag(argv, flag) {
  return Array.isArray(argv) && argv.includes(flag);
}

/** `--name value` 取值；后面紧跟另一个选项或已到末尾时视为未提供。 */
export function getOption(argv, name) {
  if (!Array.isArray(argv)) return undefined;
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

/** `--items a,b` 支持逗号分隔，也支持同一个选项重复出现多次。 */
export function collectList(argv, name) {
  const out = [];
  if (!Array.isArray(argv)) return out;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) continue;
    out.push(...value.split(/[,，]/).map((item) => item.trim()).filter(Boolean));
  }
  return out;
}
