import { AmazonS3Vectors } from '../../src/index.js';
import type { AmazonS3VectorsConfig, DistanceMetric } from '../../src/index.js';

const metric: DistanceMetric = 'cosine';
// @ts-expect-error -- 'manhattan' is not a valid DistanceMetric
const badMetric: DistanceMetric = 'manhattan';

const config: AmazonS3VectorsConfig = { vectorBucketName: 'b', indexName: 'idx' };
// @ts-expect-error -- vectorBucketName is required
const badConfig: AmazonS3VectorsConfig = { indexName: 'idx' };

const store = new AmazonS3Vectors(undefined, config);
const storeType: string = store._vectorstoreType();

void metric;
void badMetric;
void badConfig;
void storeType;
