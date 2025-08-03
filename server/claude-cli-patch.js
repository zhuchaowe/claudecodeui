// Patch for claude-cli.js to handle spawn in Docker container
// This file contains the modifications needed for spawn to work properly

// Original spawn call at line 258:
// const claudeProcess = spawn(cliCommand, args, {
//   cwd: workingDir,
//   stdio: ['pipe', 'pipe', 'pipe'],
//   env: { ...process.env }
// });

// Should be replaced with:
// let spawnCommand, spawnArgs;
// 
// // Handle different command formats
// if (cliCommand.includes(' ')) {
//   // If command contains spaces, split it
//   const parts = cliCommand.split(' ');
//   spawnCommand = parts[0];
//   spawnArgs = [...parts.slice(1), ...args];
// } else if (cliCommand.endsWith('claude-wrapper')) {
//   // Use shell for wrapper script
//   spawnCommand = 'sh';
//   spawnArgs = ['-c', `${cliCommand} ${args.map(a => `"${a}"`).join(' ')}`];
// } else {
//   spawnCommand = cliCommand;
//   spawnArgs = args;
// }
// 
// const claudeProcess = spawn(spawnCommand, spawnArgs, {
//   cwd: workingDir,
//   stdio: ['pipe', 'pipe', 'pipe'],
//   env: { ...process.env },
//   shell: false
// });