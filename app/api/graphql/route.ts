import { ApolloServer } from "@apollo/server";
import { startServerAndCreateNextHandler } from "@as-integrations/next";
import { NextRequest } from "next/server";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { readFileSync } from "fs";
import { join } from "path";
import { resolvers } from "../../../schema/resolvers";

const typeDefs = readFileSync(
  join(process.cwd(), "schema/schema.graphql"),
  "utf-8",
);

const schema = makeExecutableSchema({ typeDefs, resolvers });
const server = new ApolloServer({ schema });

const handler = startServerAndCreateNextHandler<NextRequest>(server);

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
