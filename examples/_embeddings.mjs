import { BedrockEmbeddings } from '@langchain/aws';

const TITAN_V2_MODEL_ID = 'amazon.titan-embed-text-v2:0';

export function createEmbeddings(region) {
  return new BedrockEmbeddings({ region, model: TITAN_V2_MODEL_ID });
}