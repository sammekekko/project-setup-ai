import { cosineSimilarity, embed, embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export const embedding_model = openai.embedding("text-embedding-3-large");
export const db: { embedding: number[]; value: string }[] = [];

export async function create_embedding() {
  const resourses_path = path.join(process.cwd(), "./resources");
  const libraries_path = path.join(resourses_path, "libraries.txt");
  const embeddings_path = path.join(resourses_path, "embeddings.json");

  const libraries = fs.readFileSync(libraries_path, "utf8");
  const chunks = libraries
    .split(".")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && chunk !== "\n");

  const { embeddings } = await embedMany({
    model: embedding_model,
    values: chunks,
  });

  embeddings.forEach((e, i) => {
    db.push({
      embedding: e,
      value: chunks[i],
    });
  });

  fs.writeFileSync(embeddings_path, JSON.stringify(db, null, 2));
  console.log(
    "Created embeddings store and added to local and long term memory."
  );
}

// Prompts the user with a question and returns their input.
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function recreate_embedding() {
  const answer = await askQuestion(
    "Embeddings file already exists. Do you want to delete it and create a new one? (Y/n): "
  );

  // Accept 'y' or an empty answer (default) as confirmation to delete.
  if (answer.trim().toLowerCase() === "y" || answer.trim() === "") {
    const embeddingsPath = path.join(
      process.cwd(),
      "./resources/embeddings.json"
    );
    try {
      fs.unlinkSync(embeddingsPath);
      console.log(
        "Deleted existing embeddings file.\nNow creating a new one..."
      );
      await create_embedding();
    } catch (err) {
      console.error("Error deleting the embeddings file:", err);
      process.exit(1);
    }
  } else {
    console.log("Keeping existing embeddings file.");
    // Optionally, load the existing embeddings if needed.
    await load_embeddings();
    return;
  }
}

export async function load_embeddings() {
  const filePath = path.join(process.cwd(), "./resources/embeddings.json");
  console.log(filePath);
  if (!fs.existsSync(filePath)) {
    await create_embedding();
    return;
  }

  const data = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(data);
  parsed.forEach((item: { embedding: number[]; value: string }) =>
    db.push(item)
  );
}

export async function get_context(input: string) {
  if (db.length === 0) {
    await load_embeddings();
  }

  const { embedding } = await embed({
    model: embedding_model,
    value: input,
  });
  const context = db
    .map((item) => ({
      document: item,
      similarity: cosineSimilarity(embedding, item.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map((r) => r.document.value)
    .join("\n");

  return context;
}
