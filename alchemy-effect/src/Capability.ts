import * as Effect from "effect/Effect";
import type { Instance } from ".//Util/instance.ts";
import * as Policy from "./Policy/index.ts";

/** declare a Policy requiring Capabilities in some context */
export const declare = <S extends Capability>() =>
  Effect.gen(function* () {}) as Effect.Effect<void, never, S>;

export interface ICapability<
  Type extends string = string,
  Resource = unknown,
  Constraint = unknown,
> {
  type: Type;
  resource: Resource;
  constraint: Constraint;
  sid: string;
  label: string;
}

export interface Capability<
  Type extends string = string,
  Resource = unknown,
  Constraint = unknown,
> extends ICapability<Type, Resource, Constraint> {
  new (): {};
}

export interface Satisfied<Cap extends Capability> {
  satisfied: Cap;
}

export declare namespace Capability {
  export type Simplify<C> = [C] extends [
    {
      Constructor: { Reduce: any };
    },
  ]
    ? _Simplify<C>
    : C;

  type _Simplify<C> = [C] extends [
    infer c extends { Constructor: any; resource: any; constraint: any },
  ]
    ? (c["Constructor"] & {
        resource: c["resource"];
        constraint: Constraint.Simplify<c["constraint"]>;
      })["Reduce"]
    : never;

  type KeysWithNever<T> = {
    [K in keyof T]: T[K] extends never | Policy.AnyOf<never> ? K : never;
  }[keyof T];
  type DropIrrelevant<T> = T extends any
    ? {
        [k in keyof Omit<T, KeysWithNever<T>>]: Omit<T, KeysWithNever<T>>[k];
      }
    : never;
  type Get<T, K extends string | number | symbol> = T extends {
    [k in K]: infer V;
  }
    ? V
    : never;
  type Keys<T> = T extends any ? keyof T : never;
  type BoxPolicy<T> = [T] extends [{ anyOf: (infer U)[] }]
    ? Policy.AnyOf<U>
    : never;
  export namespace Constraint {
    export type Simplify<Constraint> = {
      [k in Keys<DropIrrelevant<Constraint>>]: BoxPolicy<Get<Constraint, k>>;
    };
  }
}

// syntactic sugar for mapping `typeof Messages` -> Messages, e.g. so it's SQS.SendMessage<Messages> instead of SQS.SendMessage<typeof Messages>
// e.g. <Q extends SQS.Queue>(queue: Q) => SQS.SendMessage<To<Q>>
export type From<T> = Instance<T>;
export type To<T> = Instance<T>;
export type In<T> = Instance<T>;
export type Into<T> = Instance<T>;
export type On<T> = Instance<T>;
