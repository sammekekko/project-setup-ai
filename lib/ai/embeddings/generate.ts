import { create_embedding, recreate_embedding } from "./embedding_manager";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

// Returns true if the embeddings file exists.
function is_already_generated(): boolean {
  const embeddings = path.join(process.cwd(), "./resources/embeddings.json");
  return fs.existsSync(embeddings);
}

async function main() {
  if (!is_already_generated()) {
    console.log("Creating embedding...");
    await create_embedding();
    return;
  }

  recreate_embedding();
}

main().catch((err) => {
  console.error("Error generating embeddings:", err);
  process.exit(1);
});
