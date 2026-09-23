const axios = require("axios").default;
const { decryptGithubToken } = require("../updater");
const token = decryptGithubToken();
if(!token) { process.exit(1); }

const headers = { "Accept": "application/vnd.github+json", "Authorization": "Bearer " + token };
const CLIENT_REPO = "Bosta-Client/client-1.8.9";

axios.get(`https://api.github.com/repos/${CLIENT_REPO}/tags`, { headers, timeout: 8000 })
	.then(r => {
		const tags = r.data.map(t => t.name).filter(t => /^\d/.test(t));
		if(tags.length === 0) { console.log("1.0.0-beta"); return; }

		const sorted = tags.sort((a, b) => {
			const pa = a.replace(/[^0-9.]/g, "").split(".").map(Number);
			const pb = b.replace(/[^0-9.]/g, "").split(".").map(Number);
			for(let i = 0; i < Math.max(pa.length, pb.length); i++) {
				const va = pa[i] || 0, vb = pb[i] || 0;
				if(va !== vb) return vb - va;
			}
			return 0;
		});

		const latest = sorted[0];
		const parts = latest.replace(/[^0-9.]/g, "").split(".").map(Number);
		parts[parts.length - 1]++;
		const suffix = latest.includes("beta") ? "-beta" : "";
		process.stdout.write(parts.join(".") + suffix);
	})
	.catch(() => { process.exit(1); });
