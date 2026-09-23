const { decryptGithubToken } = require("../updater");
const token = decryptGithubToken();
if(!token) {
	console.error("Failed to decrypt GitHub token");
	process.exit(1);
}
process.stdout.write(token);
