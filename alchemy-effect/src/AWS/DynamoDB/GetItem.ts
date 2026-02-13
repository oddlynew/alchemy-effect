import type { HttpClient } from "@effect/platform/HttpClient";
import type { Credentials } from "distilled-aws/Credentials";
import type {
  ConsumedCapacity,
  InternalServerError,
  InvalidEndpointException,
  ProvisionedThroughputExceededException,
  RequestLimitExceeded,
  ResourceNotFoundException,
  ReturnConsumedCapacity,
  ThrottlingException,
} from "distilled-aws/dynamodb";
import * as DynamoDB from "distilled-aws/dynamodb";
import type { CommonErrors } from "distilled-aws/Errors";
import type { Region } from "distilled-aws/Region";
import { Effect } from "effect";
import { Binding } from "../../Binding.ts";
import type { Capability, From } from "../../Capability.ts";
import { toEnvKey } from "../../Env.ts";
import * as Policy from "../../Policy/index.ts";
import { fromAttributeValue } from "./AttributeValue.ts";
import type { Identifier } from "./Expr.ts";
import type { ParseProjectionExpression } from "./ProjectionExpression.ts";
import { Table } from "./Table.ts";

// Helper types extracted for explicit type annotations
type GetItemParsed<ProjectionExpression extends string> =
  ParseProjectionExpression<ProjectionExpression>;

type GetItemAttributes<ProjectionExpression extends string> = Extract<
  GetItemParsed<ProjectionExpression>[number],
  Identifier
>["name"];

type GetItemLeadingKeys<
  T extends Table<string, any>,
  Key extends Table.Key<T>,
> = Extract<Key[T["props"]["partitionKey"]], string>;

type GetItemDeclaredConstraint<
  T extends Table<string, any>,
  Key extends Table.Key<T>,
  ProjectionExpression extends string,
  Capacity extends ReturnConsumedCapacity,
> = Policy.Constraint<{
  leadingKeys: Policy.AnyOf<GetItemLeadingKeys<T, Key>>;
  attributes: Policy.AnyOf<GetItemAttributes<ProjectionExpression>>;
  returnConsumedCapacity: Policy.AnyOf<Capacity>;
}>;

export interface GetItemResult<
  T extends Table<string, any>,
  Key extends Table.Key<T>,
> {
  Item: (InstanceType<T["props"]["items"]> & Key) | undefined;
  ConsumedCapacity?: ConsumedCapacity;
}

export interface GetItemConstraint<
  LeadingKeys extends Policy.AnyOf<any> = Policy.AnyOf<any>,
  Attributes extends Policy.AnyOf<any> = Policy.AnyOf<any>,
  ReturnConsumedCapacity extends Policy.AnyOf<any> = Policy.AnyOf<any>,
> {
  leadingKeys?: LeadingKeys;
  attributes?: Attributes;
  returnConsumedCapacity?: ReturnConsumedCapacity;
}

export interface GetItem<
  T = unknown,
  Constraint extends GetItemConstraint | unknown = unknown,
> extends Capability<"AWS.DynamoDB.GetItem", T, Constraint> {
  Constructor: GetItem;
  Reduce: GetItem<
    this["resource"],
    {
      [k in keyof Capability.Constraint.Simplify<
        this["constraint"]
      >]: Capability.Constraint.Simplify<this["constraint"]>[k];
    }
  >;
}

export const GetItem = Binding("AWS.DynamoDB.GetItem")<
  <
    T extends Table,
    const LeadingKeys extends Policy.AnyOf<any> = Policy.AnyOf<string>,
    const Attributes extends Policy.AnyOf<any> = never,
    const ReturnConsumedCapacity extends Policy.AnyOf<any> = never,
  >(
    table: T,
    constraint?: GetItemConstraint<
      LeadingKeys,
      Attributes,
      ReturnConsumedCapacity
    >,
  ) => GetItem<
    From<T>,
    Policy.Constraint<{
      leadingKeys: LeadingKeys;
      attributes: Attributes;
      returnConsumedCapacity: ReturnConsumedCapacity;
    }>
  >
>();

// Error type for getItem operations
type GetItemError =
  | InternalServerError
  | InvalidEndpointException
  | ProvisionedThroughputExceededException
  | RequestLimitExceeded
  | ResourceNotFoundException
  | ThrottlingException
  | CommonErrors;

// see: https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazondynamodb.html
export const getItem: <
  T extends Table<string, any>,
  const Key extends Table.Key<T>,
  const ProjectionExpression extends string = never,
  const Capacity extends ReturnConsumedCapacity = never,
>(args: {
  table: T;
  key: Key;
  projectionExpression?: ProjectionExpression;
  returnConsumedCapacity?: Capacity;
}) => Effect.Effect<
  GetItemResult<T, Key>,
  GetItemError,
  | Credentials
  | Region
  | HttpClient
  | GetItem<
      From<T>,
      {
        [k in keyof GetItemDeclaredConstraint<
          T,
          Key,
          ProjectionExpression,
          Capacity
        >]: GetItemDeclaredConstraint<
          T,
          Key,
          ProjectionExpression,
          Capacity
        >[k];
      }
    >
> = Effect.fnUntraced(function* ({
  table,
  key,
  projectionExpression,
  returnConsumedCapacity,
}) {
  const tableNameEnv = toEnvKey(table.id, "TABLE_NAME");
  const tableName = process.env[tableNameEnv];
  if (!tableName) {
    return yield* Effect.die(new Error(`${tableNameEnv} is not set`));
  }
  const { Item, ...rest } = yield* DynamoDB.getItem({
    TableName: tableName,
    Key: {
      [table.props.partitionKey]: {
        S: (key as any)[table.props.partitionKey] as string,
      },
      ...(table.props.sortKey
        ? {
            [table.props.sortKey]: {
              S: (key as any)[table.props.sortKey] as string,
            },
          }
        : {}),
    },
    ProjectionExpression: projectionExpression,
    ReturnConsumedCapacity: returnConsumedCapacity,
  });

  return {
    ...rest,
    Item: Item
      ? (Object.fromEntries(
          yield* Effect.promise(() =>
            Promise.all(
              Object.entries(Item!).map(async ([key, value]) => [
                key,
                await fromAttributeValue(value!),
              ]),
            ),
          ),
        ) as any)
      : undefined,
  };
});

export const GetItemProvider = () =>
  GetItem.provider.succeed({
    attach: ({ source: table, props }) => ({
      env: {
        [toEnvKey(table.id, "TABLE_NAME")]: table.attr.tableName,
        [toEnvKey(table.id, "TABLE_ARN")]: table.attr.tableArn,
      },
      policyStatements: [
        {
          Sid: "GetItem",
          Effect: "Allow",
          Action: ["dynamodb:GetItem"],
          Resource: [table.attr.tableArn],
          Condition:
            props?.leadingKeys ||
            props?.attributes ||
            props?.returnConsumedCapacity
              ? {
                  // https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazondynamodb.html#amazondynamodb-dynamodb_LeadingKeys

                  // TODO(sam): add StringLike for prefixes, templates, etc.
                  "ForAllValues:StringEquals": {
                    "dynamodb:LeadingKeys": props.leadingKeys
                      ?.anyOf as string[],
                    "dynamodb:Attributes": props.attributes?.anyOf as string[],
                    "dynamodb:ReturnConsumedCapacity": props
                      .returnConsumedCapacity?.anyOf as string[],
                  },
                }
              : undefined,
        },
      ],
    }),
  });
