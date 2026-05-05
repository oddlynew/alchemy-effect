import { adopt } from "@/AdoptPolicy";
import * as AWS from "@/AWS";
import { Distribution, OriginAccessControl } from "@/AWS/CloudFront";
import type { PolicyStatement } from "@/AWS/IAM/Policy";
import { Bucket } from "@/AWS/S3";
import * as Output from "@/Output";
import { State } from "@/State";
import * as Test from "@/Test/Vitest";
import * as cloudfront from "@distilled.cloud/aws/cloudfront";
import * as S3 from "@distilled.cloud/aws/s3";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

const { test } = Test.make({ providers: AWS.providers() });

const runLive = process.env.ALCHEMY_RUN_LIVE_AWS_WEBSITE_TESTS === "true";

describe("AWS.CloudFront.Distribution", () => {
  test.provider.skipIf(!runLive)(
    "create and delete distribution for a private S3 origin",
    (stack) =>
      Effect.gen(function* () {
        yield* stack.destroy();

        const deployed = yield* stack.deploy(
          Effect.gen(function* () {
            const bucket = yield* Bucket("WebsiteBucket", {
              forceDestroy: true,
            });
            const oac = yield* OriginAccessControl("WebsiteOac", {
              originType: "s3",
            });
            const distribution = yield* Distribution("WebsiteDistribution", {
              origins: [
                {
                  id: "site",
                  domainName: bucket.bucketRegionalDomainName,
                  s3Origin: true,
                  originAccessControlId: oac.originAccessControlId,
                },
              ],
              defaultRootObject: "index.html",
              defaultCacheBehavior: {
                targetOriginId: "site",
                viewerProtocolPolicy: "redirect-to-https",
                compress: true,
                allowedMethods: ["GET", "HEAD"],
                cachedMethods: ["GET", "HEAD"],
                forwardedValues: {
                  QueryString: false,
                  Cookies: {
                    Forward: "none",
                  },
                },
              },
            });

            const statement: PolicyStatement = {
              Effect: "Allow",
              Principal: {
                Service: "cloudfront.amazonaws.com",
              },
              Action: ["s3:GetObject"],
              Resource: [Output.interpolate`${bucket.bucketArn}/*` as any],
              Condition: {
                StringEquals: {
                  "AWS:SourceArn": distribution.distributionArn as any,
                },
              },
            };

            yield* bucket.bind`Allow(${distribution}, CloudFront.Read(${bucket}))`(
              {
                policyStatements: [statement],
              },
            );

            return {
              bucket,
              oac,
              distribution,
            };
          }),
        );

        const current = yield* cloudfront.getDistribution({
          Id: deployed.distribution.distributionId,
        });
        expect(current.Distribution?.Status).toEqual("Deployed");
        expect(current.Distribution?.DomainName).toEqual(
          deployed.distribution.domainName,
        );

        const control = yield* cloudfront.getOriginAccessControl({
          Id: deployed.oac.originAccessControlId,
        });
        expect(control.OriginAccessControl?.Id).toEqual(
          deployed.oac.originAccessControlId,
        );

        yield* S3.putObject({
          Bucket: deployed.bucket.bucketName,
          Key: "index.html",
          Body: "<html>ok</html>",
          ContentType: "text/html; charset=utf-8",
        });

        yield* stack.destroy();
        yield* assertDistributionDeleted(deployed.distribution.distributionId);
      }),
    { timeout: 600_000 },
  );

  test.provider.skipIf(!runLive)(
    "redeploy with same props is a no-op",
    (stack) =>
      Effect.gen(function* () {
        yield* stack.destroy();

        const initial = yield* stack.deploy(makeMinimalDistribution());
        const second = yield* stack.deploy(makeMinimalDistribution());

        expect(second.distributionId).toEqual(initial.distributionId);
        expect(second.distributionArn).toEqual(initial.distributionArn);
        expect(second.domainName).toEqual(initial.domainName);

        yield* stack.destroy();
        yield* assertDistributionDeleted(initial.distributionId);
      }),
    { timeout: 1_800_000 },
  );

  test.provider.skipIf(!runLive)(
    "reconcile resets comment mutated out-of-band via raw CloudFront SDK",
    (stack) =>
      Effect.gen(function* () {
        yield* stack.destroy();

        const initial = yield* stack.deploy(
          makeMinimalDistribution({ comment: "alchemy-managed" }),
        );

        // Mutate the distribution comment out of band via the raw SDK.
        const config = yield* cloudfront.getDistributionConfig({
          Id: initial.distributionId,
        });
        yield* cloudfront.updateDistribution({
          Id: initial.distributionId,
          IfMatch: config.ETag,
          DistributionConfig: {
            ...config.DistributionConfig!,
            Comment: "drifted-comment",
          },
        });
        yield* waitForDistributionDeployed(initial.distributionId);

        // Re-deploy with the original desired comment — reconcile must
        // reset the drifted attribute back. This exercises the
        // read-then-update flow with a fresh ETag.
        const reconciled = yield* stack.deploy(
          makeMinimalDistribution({ comment: "alchemy-managed" }),
        );
        expect(reconciled.distributionId).toEqual(initial.distributionId);

        const after = yield* cloudfront.getDistributionConfig({
          Id: initial.distributionId,
        });
        expect(after.DistributionConfig?.Comment).toEqual("alchemy-managed");

        yield* stack.destroy();
        yield* assertDistributionDeleted(initial.distributionId);
      }),
    { timeout: 1_800_000 },
  );

  test.provider.skipIf(!runLive)(
    "destroying an already-deleted distribution is a no-op",
    (stack) =>
      Effect.gen(function* () {
        yield* stack.destroy();

        const dist = yield* stack.deploy(makeMinimalDistribution());

        // Drop the distribution out from under the engine. The provider's
        // delete must catch NoSuchDistribution and complete cleanly.
        yield* disableAndDeleteDistribution(dist.distributionId);
        yield* assertDistributionDeleted(dist.distributionId);

        yield* stack.destroy();
      }),
    { timeout: 1_800_000 },
  );

  test.provider.skipIf(!runLive)(
    "adopt(true) takes over a foreign-tagged distribution",
    (stack) =>
      Effect.gen(function* () {
        yield* stack.destroy();

        const initial = yield* stack.deploy(makeMinimalDistribution());

        // Forget the resource locally so the next deploy enters the
        // adoption path: Read sees the existing distribution by caller
        // reference, but it lacks our internal tags.
        yield* Effect.gen(function* () {
          const state = yield* State;
          yield* state.delete({
            stack: stack.name,
            stage: "test",
            fqn: "Adoptee",
          });
        }).pipe(Effect.provide(stack.state));

        const taken = yield* stack
          .deploy(makeMinimalDistribution())
          .pipe(adopt(true));

        expect(taken.distributionId).toEqual(initial.distributionId);
        // Internal alchemy tags should now be present after adoption.
        const tags = yield* cloudfront.listTagsForResource({
          Resource: taken.distributionArn,
        });
        const tagMap = Object.fromEntries(
          (tags.Tags?.Items ?? [])
            .filter(
              (t): t is { Key: string; Value: string } =>
                typeof t.Key === "string" && typeof t.Value === "string",
            )
            .map((t) => [t.Key, t.Value]),
        );
        expect(tagMap["alchemy:fqn"]).toBeDefined();
        expect(tagMap["alchemy:stage"]).toBeDefined();

        yield* stack.destroy();
        yield* assertDistributionDeleted(initial.distributionId);
      }),
    { timeout: 1_800_000 },
  );
});

const makeMinimalDistribution = (overrides?: { comment?: string }) =>
  Effect.gen(function* () {
    const bucket = yield* Bucket("AdopteeBucket", { forceDestroy: true });
    const oac = yield* OriginAccessControl("AdopteeOac", {
      originType: "s3",
    });
    return yield* Distribution("Adoptee", {
      origins: [
        {
          id: "site",
          domainName: bucket.bucketRegionalDomainName,
          s3Origin: true,
          originAccessControlId: oac.originAccessControlId,
        },
      ],
      defaultRootObject: "index.html",
      defaultCacheBehavior: {
        targetOriginId: "site",
        viewerProtocolPolicy: "redirect-to-https",
        compress: true,
        allowedMethods: ["GET", "HEAD"],
        cachedMethods: ["GET", "HEAD"],
        forwardedValues: {
          QueryString: false,
          Cookies: { Forward: "none" },
        },
      },
      comment: overrides?.comment,
    });
  });

const waitForDistributionDeployed = (distributionId: string) =>
  cloudfront.getDistribution({ Id: distributionId }).pipe(
    Effect.flatMap((response) =>
      response.Distribution?.Status === "Deployed"
        ? Effect.void
        : Effect.fail(new Error("DistributionNotDeployed")),
    ),
    Effect.retry({
      while: (error) =>
        error instanceof Error && error.message === "DistributionNotDeployed",
      schedule: Schedule.fixed("10 seconds").pipe(
        Schedule.both(Schedule.recurs(120)),
      ),
    }),
  );

/**
 * Disable the distribution then delete it via the raw SDK. CloudFront
 * forbids deleting an enabled distribution, so this mirrors the
 * provider's delete flow without going through the engine.
 */
const disableAndDeleteDistribution = (distributionId: string) =>
  Effect.gen(function* () {
    const config = yield* cloudfront.getDistributionConfig({
      Id: distributionId,
    });
    if (config.DistributionConfig?.Enabled) {
      yield* cloudfront.updateDistribution({
        Id: distributionId,
        IfMatch: config.ETag,
        DistributionConfig: {
          ...config.DistributionConfig!,
          Enabled: false,
        },
      });
      yield* waitForDistributionDeployed(distributionId);
    }
    const latest = yield* cloudfront.getDistributionConfig({
      Id: distributionId,
    });
    yield* cloudfront
      .deleteDistribution({
        Id: distributionId,
        IfMatch: latest.ETag,
      })
      .pipe(Effect.catchTag("NoSuchDistribution", () => Effect.void));
  });

const assertDistributionDeleted = (distributionId: string) =>
  cloudfront.getDistribution({ Id: distributionId }).pipe(
    Effect.flatMap(() => Effect.fail(new Error("DistributionStillExists"))),
    Effect.catchTag("NoSuchDistribution", () => Effect.void),
    Effect.retry({
      while: (error) =>
        error instanceof Error && error.message === "DistributionStillExists",
      schedule: Schedule.fixed("10 seconds").pipe(
        Schedule.both(Schedule.recurs(60)),
      ),
    }),
  );
