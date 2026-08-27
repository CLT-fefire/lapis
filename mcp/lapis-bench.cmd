@echo off
rem lapis-bench - 인덱스 빌드 비용 벤치.
rem
rem Windows 짝이다. 확장자 없는 sh 래퍼와 같은 이름-같은 진입점을 불러야 한다 -
rem scripts/launchers.test.ts 가 그걸 못 박는다. 번들은 bundle-run.mjs 가 맡는다.
node "%~dp0..\scripts\bundle-run.mjs" bench "%~dp0benchRun.ts" %*
