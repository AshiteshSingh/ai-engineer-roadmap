# SOLID Principles

SOLID is a set of five object-oriented design principles that guide developers toward writing code that is easier to understand, extend, and maintain. Coined by Robert C. Martin and popularized in the early 2000s, these principles remain foundational to software engineering — whether you are building [microservices](/microservices), monoliths, or AI-powered backends. Mastering SOLID helps you avoid the cascading breakage, rigid coupling, and untestable code that plague projects as they grow.

## The 30-Second Pitch

SOLID stands for five principles: **S**ingle Responsibility, **O**pen/Closed, **L**iskov Substitution, **I**nterface Segregation, and **D**ependency Inversion. Together they address a single meta-problem: **managing change**. Software that follows SOLID can absorb new requirements, swap implementations, and scale across teams without collapsing under its own weight. You do not need to apply them dogmatically — the goal is to internalize the trade-offs so you recognize when a design is fighting you and know which lever to pull.

## Single Responsibility Principle (SRP)

> A class should have one, and only one, reason to change.

SRP does not mean "do one thing." It means a module should be responsible to **one actor** — one group of stakeholders whose requirements evolve together. When a class serves multiple actors, a change requested by one actor risks breaking the other.

### Violation

```typescript
class UserService {
  async register(email: string, password: string) {
    // validation logic
    if (!email.includes("@")) throw new Error("Invalid email");
    // persistence
    const id = await db.insert(users).values({ email, password: hash(password) }).returning();
    // notification
    await sendWelcomeEmail(email);
    // analytics
    await trackEvent("user_registered", { userId: id });
    return id;
  }
}
```

This single method answers to four stakeholders: validation rules (product), persistence format (data team), email templates (marketing), and analytics schema (growth). A change to the analytics event shape risks regressions in the registration flow.

### Fix

```typescript
// Each class has one reason to change
class UserValidator {
  validate(email: string, password: string) {
    if (!email.includes("@")) throw new Error("Invalid email");
    if (password.length < 8) throw new Error("Password too short");
  }
}

class UserRepository {
  async create(email: string, password: string) {
    return db.insert(users).values({ email, password: hash(password) }).returning();
  }
}

class NotificationService {
  async welcomeEmail(email: string) {
    await sendWelcomeEmail(email);
  }
}

class RegistrationService {
  constructor(
    private validator: UserValidator,
    private repo: UserRepository,
    private notifier: NotificationService,
  ) {}

  async register(email: string, password: string) {
    this.validator.validate(email, password);
    const user = await this.repo.create(email, password);
    await this.notifier.welcomeEmail(email);
    return user;
  }
}
```

Now each component can change independently. The `RegistrationService` orchestrates the workflow but delegates the details.

## Open/Closed Principle (OCP)

> Software entities should be open for extension but closed for modification.

You should be able to add new behavior **without editing existing code**. This is typically achieved through polymorphism — define a contract (interface or abstract class), then add new implementations. The existing code that depends on the contract never changes.

### Example: Pricing strategies

```typescript
// Closed for modification — this interface won't change
interface PricingStrategy {
  calculate(basePrice: number, quantity: number): number;
}

// Open for extension — add new strategies freely
class StandardPricing implements PricingStrategy {
  calculate(basePrice: number, quantity: number) {
    return basePrice * quantity;
  }
}

class BulkPricing implements PricingStrategy {
  calculate(basePrice: number, quantity: number) {
    const discount = quantity >= 100 ? 0.8 : quantity >= 50 ? 0.9 : 1;
    return basePrice * quantity * discount;
  }
}

class SubscriptionPricing implements PricingStrategy {
  calculate(basePrice: number, quantity: number) {
    return basePrice * 0.7; // flat 30% subscriber discount, quantity ignored
  }
}

// This function is CLOSED — it never needs to change when pricing rules evolve
function computeTotal(strategy: PricingStrategy, basePrice: number, qty: number) {
  return strategy.calculate(basePrice, qty);
}
```

Adding a `PromotionalPricing` next quarter requires zero modifications to `computeTotal` or any existing strategy. Compare this to a single function with an ever-growing `switch` statement — every new pricing rule risks breaking the others.

## Liskov Substitution Principle (LSP)

> Subtypes must be substitutable for their base types without altering the correctness of the program.

If code works with type `T`, it must also work correctly with any subtype `S extends T`. Violations show up as unexpected exceptions, broken invariants, or methods that silently do the wrong thing.

### Classic violation: Square extends Rectangle

```typescript
class Rectangle {
  constructor(protected width: number, protected height: number) {}

  setWidth(w: number) { this.width = w; }
  setHeight(h: number) { this.height = h; }
  area() { return this.width * this.height; }
}

class Square extends Rectangle {
  setWidth(w: number) { this.width = w; this.height = w; }  // surprise!
  setHeight(h: number) { this.width = h; this.height = h; } // surprise!
}

function resize(rect: Rectangle) {
  rect.setWidth(5);
  rect.setHeight(10);
  console.assert(rect.area() === 50); // fails for Square — area is 100
}
```

The `Square` subtype violates the expected behavior of `Rectangle`. The fix is to avoid the inheritance relationship entirely — use a `Shape` interface with an `area()` method, and model `Rectangle` and `Square` as independent implementations.

### Real-world LSP in TypeScript

LSP violations in practice often look like this:

```typescript
interface Logger {
  log(message: string): void;
}

class ConsoleLogger implements Logger {
  log(message: string) { console.log(message); }
}

// LSP violation — throws where the contract says it won't
class ReadOnlyLogger implements Logger {
  log(message: string) {
    throw new Error("This logger does not support writing");
  }
}
```

Any code expecting a `Logger` would break when handed a `ReadOnlyLogger`. If some loggers are read-only, the interface needs to reflect that — perhaps split into `Writable` and `Readable` logger interfaces, which leads directly to the next principle.

## Interface Segregation Principle (ISP)

> No client should be forced to depend on methods it does not use.

Fat interfaces create coupling between unrelated concerns. When interface `A` has methods `x`, `y`, and `z`, but client 1 only uses `x` and client 2 only uses `y`, a change to `z` still forces both clients to recompile (or worse, handle methods they never call).

### Violation: the "god" interface

```typescript
interface DataStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  subscribe(key: string, cb: (value: string) => void): void;
  runMigration(sql: string): Promise<void>;
  backup(): Promise<Buffer>;
}
```

A simple caching layer that only needs `read` and `write` is now coupled to subscription, migration, and backup contracts.

### Fix: segregated interfaces

```typescript
interface Readable {
  read(key: string): Promise<string | null>;
}

interface Writable {
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Subscribable {
  subscribe(key: string, cb: (value: string) => void): void;
}

interface Administrable {
  runMigration(sql: string): Promise<void>;
  backup(): Promise<Buffer>;
}

// A full-featured store implements all of them
class PostgresStore implements Readable, Writable, Subscribable, Administrable {
  // ... implement all methods
}

// A cache only depends on what it needs
class CacheLayer {
  constructor(private store: Readable & Writable) {}
}
```

ISP pairs naturally with [microservices](/microservices) — each service's API surface should expose only the operations its consumers need, not a monolithic "everything" endpoint.

## Dependency Inversion Principle (DIP)

> High-level modules should not depend on low-level modules. Both should depend on abstractions.

DIP is the most architecturally impactful SOLID principle. Without it, your business logic is welded to specific databases, HTTP clients, and third-party SDKs. With it, you can swap implementations, test in isolation, and evolve infrastructure independently.

### Without DIP

```typescript
import { neon } from "@neondatabase/serverless";

class OrderService {
  private sql = neon(process.env.DATABASE_URL!);

  async createOrder(userId: string, items: CartItem[]) {
    // Directly coupled to Neon PostgreSQL
    const result = await this.sql`
      INSERT INTO orders (user_id, total)
      VALUES (${userId}, ${computeTotal(items)})
      RETURNING id
    `;
    return result[0].id;
  }
}
```

Testing this requires a live Neon database. Migrating to a different database means rewriting the service.

### With DIP

```typescript
// Abstraction — owned by the high-level module
interface OrderRepository {
  create(userId: string, total: number): Promise<string>;
}

// Low-level implementation
class NeonOrderRepository implements OrderRepository {
  constructor(private sql: ReturnType<typeof neon>) {}

  async create(userId: string, total: number) {
    const result = await this.sql`
      INSERT INTO orders (user_id, total) VALUES (${userId}, ${total}) RETURNING id
    `;
    return result[0].id;
  }
}

// High-level module depends on the abstraction
class OrderService {
  constructor(private repo: OrderRepository) {}

  async createOrder(userId: string, items: CartItem[]) {
    return this.repo.create(userId, computeTotal(items));
  }
}

// In tests — swap with in-memory implementation
class InMemoryOrderRepository implements OrderRepository {
  private orders = new Map<string, number>();
  async create(userId: string, total: number) {
    const id = crypto.randomUUID();
    this.orders.set(id, total);
    return id;
  }
}
```

The `OrderService` no longer knows or cares about PostgreSQL. The dependency arrow has been **inverted** — the low-level module conforms to the high-level module's contract, not the other way around.

## SOLID in Practice — Putting It All Together

In [production-patterns](/production-patterns) for AI systems, SOLID shows up constantly:

- **SRP**: A RAG pipeline separates retrieval, re-ranking, and generation into distinct services — each with its own deployment lifecycle.
- **OCP**: An LLM gateway accepts new model providers (OpenAI, Anthropic, DeepSeek) via a `ModelProvider` interface without modifying the routing logic.
- **LSP**: Every `EmbeddingModel` implementation (OpenAI, Cohere, local ONNX) returns `number[]` of the same dimensionality — callers never need to special-case.
- **ISP**: A vector store exposes `search()` to query services and `upsert()` to ingestion pipelines — not a combined interface that leaks admin operations.
- **DIP**: Business logic depends on `SearchIndex`, not on Pinecone's SDK directly — you can switch to pgvector without touching the application layer.

## Common Pitfalls

**Over-abstraction.** Creating interfaces for everything "just in case" violates YAGNI (You Aren't Gonna Need It). If a class has exactly one implementation and no foreseeable alternative, skip the interface. Add it later when the second implementation appears.

**Misapplying SRP as "one method per class."** SRP is about cohesion — keeping things that change together in the same module. Splitting a naturally cohesive class into five fragments makes code harder to follow without improving flexibility.

**Ignoring LSP in event-driven systems.** When subscribers handle different event shapes through a common handler interface, a new event type that breaks the handler contract violates LSP — even without inheritance.

**Treating SOLID as a checklist.** These principles are heuristics, not laws. Apply them when they reduce the cost of change. If your module is small, stable, and well-tested, adding layers of abstraction for SOLID compliance creates accidental complexity.

## Testing Benefits of SOLID

SOLID and testability are deeply intertwined. Code that follows SOLID is almost always easy to unit-test; code that violates it is almost always painful to test.

| Principle | Testability Gain |
|-----------|-----------------|
| SRP | Each class has a focused surface — tests are short and precise |
| OCP | New behavior added via new classes — existing tests never break |
| LSP | Any implementation can be swapped for a test double without surprises |
| ISP | Mocks implement only the needed interface, not a god interface |
| DIP | Business logic accepts injected fakes — no live DB or HTTP in unit tests |

### Example: DIP enables fast unit tests

```typescript
// Production: inject the real repository
const service = new OrderService(new NeonOrderRepository(sql));

// Test: inject an in-memory fake — no database needed
it("creates an order and returns its id", async () => {
  const repo = new InMemoryOrderRepository();
  const service = new OrderService(repo);
  const id = await service.createOrder("user-1", [{ price: 10, qty: 2 }]);
  expect(typeof id).toBe("string");
});
```

The test runs in microseconds and never touches a database. This is only possible because DIP broke the hard dependency on Neon.

## Dependency Injection in Practice

DIP describes *what* to depend on (abstractions). DI frameworks handle *how* to wire those abstractions to concrete implementations at runtime.

### Manual wiring (composition root)

For small services, compose dependencies in a single entry point:

```typescript
// app.ts — the composition root
const sql = neon(process.env.DATABASE_URL!);
const repo = new NeonOrderRepository(sql);
const notifier = new SendgridNotifier(process.env.SENDGRID_KEY!);
const service = new OrderService(repo, notifier);

export { service };
```

### tsyringe (lightweight TypeScript DI)

```typescript
import "reflect-metadata";
import { injectable, inject, container } from "tsyringe";

@injectable()
class NeonOrderRepository implements OrderRepository {
  constructor(@inject("DatabaseUrl") private url: string) {}
  async create(userId: string, total: number) { /* ... */ }
}

@injectable()
class OrderService {
  constructor(@inject("OrderRepository") private repo: OrderRepository) {}
  async createOrder(userId: string, items: CartItem[]) {
    return this.repo.create(userId, computeTotal(items));
  }
}

// Register once
container.register("DatabaseUrl", { useValue: process.env.DATABASE_URL });
container.register<OrderRepository>("OrderRepository", NeonOrderRepository);

// Resolve anywhere
const service = container.resolve(OrderService);
```

DI containers shine in large codebases where the dependency graph is deep. For most microservices, manual wiring at the composition root is simpler and sufficient.

## SOLID at a Glance

| Principle | One-Line Rule | Key Mechanism | Violation Warning Sign |
|-----------|--------------|---------------|----------------------|
| **S**RP | One reason to change | Separate actors into separate modules | Class imports from three unrelated domains |
| **O**CP | Extend without modifying | Polymorphism via interfaces | Ever-growing `switch`/`if-else` chain |
| **L**SP | Subtypes are drop-in replacements | Honour the contract of the base type | `instanceof` checks in consuming code |
| **I**SP | No forced dependencies | Narrow, role-specific interfaces | Mock must stub methods it never calls |
| **D**IP | Depend on abstractions | Inject implementations from outside | `new ConcreteImpl()` inside a class body |

These five principles compound: SRP gives you focused modules, OCP keeps them stable, LSP makes them composable, ISP keeps interfaces lean, and DIP lets you assemble them freely. Together they produce codebases that age gracefully — new features slot in, old code stays untouched, and tests run fast.
