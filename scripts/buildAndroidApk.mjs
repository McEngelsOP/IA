import { spawnSync } from 'node:child_process'
const windows = process.platform === 'win32'
const result = spawnSync(windows ? 'gradlew.bat' : './gradlew', ['assembleRelease'], { cwd: 'android', stdio: 'inherit', shell: windows })
process.exitCode = result.status || (result.error ? 1 : 0)
