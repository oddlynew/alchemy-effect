import {
  createVolume,
  deleteVolume,
  updateVolume,
  updateVolumeInstance,
} from "@distilled.cloud/railway";
import * as Effect from "effect/Effect";
import { isResolved } from "../Diff.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import {
  resolveEnvironmentId,
  resolveProjectId,
  type EnvironmentSource,
  type ProjectSource,
} from "./Environment.ts";
import type { Providers } from "./Providers.ts";
import { resolveServiceId, type ServiceSource } from "./Service.ts";

export type VolumeProps = {
  /**
   * The Railway project (or `{ projectId }`) to create the volume in.
   */
  project: ProjectSource;
  /**
   * The environment (or `{ environmentId }`) the volume instance lives in.
   * Defaults to the project's default environment.
   */
  environment?: EnvironmentSource;
  /**
   * The service (or `{ serviceId }`) to attach the volume to.
   */
  service?: ServiceSource;
  /**
   * Path inside the container where the volume is mounted,
   * e.g. `/data`.
   */
  mountPath: string;
  /**
   * Volume name. If omitted, a unique name is generated from
   * `${app}-${stage}-${id}`.
   */
  name?: string;
  /**
   * Region to provision the volume in. Cannot be changed after creation.
   */
  region?: string;
};

export type Volume = Resource<
  "Railway.Volume",
  VolumeProps,
  {
    volumeId: string;
    name: string;
    projectId: string;
    environmentId: string | undefined;
    serviceId: string | undefined;
    mountPath: string;
    region: string | undefined;
  },
  never,
  Providers
>;

/**
 * A persistent Railway volume mounted into a service.
 *
 * @section Creating a Volume
 * @example Volume attached to a service
 * ```typescript
 * const db = yield* Railway.Service("db", {
 *   project,
 *   source: { image: "postgres:16" },
 * });
 * const data = yield* Railway.Volume("db-data", {
 *   project,
 *   service: db,
 *   mountPath: "/var/lib/postgresql/data",
 * });
 * ```
 *
 * @see https://docs.railway.com/reference/volumes
 */
export const Volume = Resource<Volume>("Railway.Volume");

export const VolumeProvider = () =>
  Provider.succeed(Volume, {
    stables: ["volumeId", "projectId", "environmentId", "region"],
    diff: Effect.fn(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      if (output) {
        const projectId = resolveProjectId(news.project as ProjectSource);
        if (projectId !== output.projectId) {
          return { action: "replace" } as const;
        }
        if (
          news.region !== undefined &&
          output.region !== undefined &&
          news.region !== output.region
        ) {
          return { action: "replace" } as const;
        }
      }
      return undefined;
    }),
    reconcile: Effect.fn(function* ({ id, news, output }) {
      const projectId = resolveProjectId(news.project as ProjectSource);
      const environmentId = news.environment
        ? resolveEnvironmentId(news.environment as EnvironmentSource)
        : undefined;
      const serviceId = news.service
        ? resolveServiceId(news.service as ServiceSource)
        : undefined;
      const name = yield* createVolumeName(id, news.name);

      if (!output) {
        const created = yield* createVolume({
          input: {
            projectId,
            environmentId,
            serviceId,
            mountPath: news.mountPath,
            region: news.region,
          },
        });
        if (created.name !== name) {
          yield* updateVolume({
            volumeId: created.id,
            input: { name },
          }).pipe(Effect.catchTag("NotAuthorized", () => Effect.void));
        }
        return {
          volumeId: created.id,
          name,
          projectId,
          environmentId,
          serviceId,
          mountPath: news.mountPath,
          region: news.region,
        };
      }

      // Sync — name and per-instance mount path / service attachment.
      if (output.name !== name) {
        yield* updateVolume({ volumeId: output.volumeId, input: { name } });
      }
      if (
        news.mountPath !== output.mountPath ||
        serviceId !== output.serviceId
      ) {
        yield* updateVolumeInstance({
          volumeId: output.volumeId,
          environmentId: environmentId ?? output.environmentId,
          input: {
            mountPath: news.mountPath,
            serviceId,
          },
        });
      }
      return {
        volumeId: output.volumeId,
        name,
        projectId,
        environmentId: environmentId ?? output.environmentId,
        serviceId,
        mountPath: news.mountPath,
        region: output.region,
      };
    }),
    delete: Effect.fn(function* ({ output }) {
      yield* deleteVolume({ volumeId: output.volumeId }).pipe(
        Effect.catchTag("NotAuthorized", () => Effect.void),
      );
    }),
  });

const createVolumeName = (id: string, name: string | undefined) =>
  Effect.gen(function* () {
    // Railway volume names have the same ~32 char limit as service names.
    return (
      name ??
      (yield* createPhysicalName({ id, lowercase: true, maxLength: 32 }))
    );
  });
