import type { AwsCredentialIdentity } from "@smithy/types";
import * as Context from "effect/Context";
import type { AccountID } from "./Account.ts";
import type { RegionID } from "./Region.ts";

export class StageConfig extends Context.Service<
  StageConfig,
  {
    account?: AccountID;
    region?: RegionID;
    profile?: string;
    credentials?: AwsCredentialIdentity;
    endpoint?: string;
  }
>()("AWS::StageConfig") {}
