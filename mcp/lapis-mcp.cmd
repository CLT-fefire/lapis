@echo off
rem lapis-mcp - 지식 질의 MCP stdio 서버.
rem
rem Windows 짝이다. 확장자 없는 sh 래퍼와 같은 이름-같은 진입점을 불러야 한다 -
rem scripts/launchers.test.ts 가 그걸 못 박는다. 번들은 bundle-run.mjs 가 맡는다.
node "%~dp0..\scripts\bundle-run.mjs" mcp "%~dp0server.ts" %*
