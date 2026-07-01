const path = require("node:path");
const dotenv = require("dotenv");
const amqp = require("amqplib");

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const queues = [
  "slack.post_approval.requested",
  "slack.post_approval.requested.dlq",
  "slack.comment_action.requested",
  "slack.comment_action.requested.dlq"
];

async function main() {
  if (!process.env.RABBITMQ_URL || process.env.RABBITMQ_URL.includes("REPLACE_WITH")) {
    throw new Error("RABBITMQ_URL is missing or still contains a placeholder in .env.local");
  }

  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  for (const queue of queues) {
    try {
      await channel.deleteQueue(queue);
      console.log(`deleted ${queue}`);
    } catch (error) {
      console.log(`skip ${queue}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await channel.close();
  await connection.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
