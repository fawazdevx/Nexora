import {archiveWorkspaceTestData} from "./store.js";

const args = new Set(process.argv.slice(2));

const result = await archiveWorkspaceTestData({
  reason: "Archived before clean Nexora demo",
  archiveAgents: !args.has("--services-only"),
  archiveServices: !args.has("--agents-only")
});

console.log(JSON.stringify(result, null, 2));
