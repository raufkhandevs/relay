# Relay slice 1A: backend spine implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Laravel 13 application with users, tickets and messages, authorised by one policy across HTTP and websockets, broadcasting live over Reverb, with an Inertia web client where two browsers hold one live conversation.

**Architecture:** One Laravel application serving two front doors. Web requests go through Inertia with session authentication; API requests use Sanctum bearer tokens. Both are authorised by `TicketPolicy`, and the same policy authorises websocket channel subscriptions, so authorisation cannot drift between transports. Response shapes are PHP data objects that emit TypeScript for the clients built in 1B and 1C.

**Tech Stack:** Laravel 13, PHP 8.5, PostgreSQL 16 in Docker, Laravel Reverb, Laravel Sanctum, Inertia, React 19, TypeScript, Tailwind, Pest, Playwright, `spatie/laravel-data`, `spatie/typescript-transformer`.

**Spec:** `docs/specs/2026-09-11-relay-design.md`

## Global constraints

- PostgreSQL, never SQLite, including under test. Decision 0004.
- Every list endpoint is paginated in the commit that introduces it. Message history uses `cursorPaginate`, ticket lists use `paginate`.
- All timestamps stored UTC.
- API response shapes are `spatie/laravel-data` objects, never raw arrays or Eloquent resources. Decision 0006.
- `last_message_at` on `tickets` has exactly one writer, `MessageObserver`. Decision 0005.
- Authorisation lives in `TicketPolicy`. HTTP routes and `routes/channels.php` both call it. Never duplicate the rule.
- Tokens are Sanctum personal access tokens. Never JWT, never in `localStorage`. Decision 0003.
- **The agent never runs `git push`.** Commit locally, then hand Rauf the exact command. This is a standing rule on this project.
- Commit messages: imperative subject under 72 characters, body explains why. Append:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU
  ```
- No em dashes in any file. Straight quotes only.

## File structure

| File | Responsibility |
|---|---|
| `docker-compose.yml` | Postgres 16 only. Nothing else is containerised. |
| `database/migrations/*_create_tickets_table.php` | Tickets schema plus the `last_message_at` index |
| `database/migrations/*_create_messages_table.php` | Messages schema plus the unique idempotency key |
| `app/Models/{User,Ticket,Message}.php` | Eloquent models, relationships, enum casts |
| `app/Enums/{UserRole,TicketStatus}.php` | Backed string enums, the only place these values are spelled |
| `app/Observers/MessageObserver.php` | Sole writer of `tickets.last_message_at` |
| `app/Policies/TicketPolicy.php` | Sole authorisation rule for tickets, used by HTTP and channels |
| `app/Data/{TicketData,MessageData,UserData}.php` | API response shapes, source of the generated TypeScript |
| `app/Http/Controllers/Api/*.php` | JSON API controllers |
| `app/Http/Controllers/TicketWebController.php` | Inertia controllers |
| `app/Events/MessageCreated.php` | The one broadcast event in this slice |
| `routes/channels.php` | Channel authorisation, delegating to `TicketPolicy` |
| `resources/js/pages/tickets/{index,show}.tsx` | Web client screens |
| `resources/js/types/generated.d.ts` | Generated, committed, never hand edited |
| `tests/Feature/*` | Pest feature tests. The policy tests are the ones that matter. |

---

### Task 1: Postgres, Laravel scaffold, repo, submodule

**Files:**
- Create: `backend-laravel/` (entire application, scaffolded)
- Create: `backend-laravel/docker-compose.yml`
- Modify: `backend-laravel/.env`
- Modify: `.gitmodules` (parent repo)

**Interfaces:**
- Consumes: nothing. This is the first task.
- Produces: a Laravel application serving on `http://localhost:8000`, a `relay` Postgres database, and `backend-laravel` registered as a submodule of the parent repo.

- [ ] **Step 1: Start Docker Desktop**

The daemon is not currently running. Open Docker Desktop and wait for it, then confirm:

```bash
docker info >/dev/null 2>&1 && echo "docker up" || echo "still down"
```

Expected: `docker up`

- [ ] **Step 2: Check the installer's actual flags**

Do not guess these. Laravel's installer flags change between versions.

```bash
laravel new --help | head -40
```

Read the output and note the flags for starter kit, database and testing framework.

- [ ] **Step 3: Scaffold the application**

From `/Users/apple/work/app-development`:

```bash
laravel new backend-laravel
```

Answer the prompts:
- Starter kit: **React**
- Authentication: **Laravel's built-in**
- Testing framework: **Pest**
- Database: **PostgreSQL**
- Run `npm install` and `npm run build`: **yes**

If the installer offers the equivalent flags found in step 2, use them instead. The answers above are what matters.

- [ ] **Step 4: Write the Postgres compose file**

Create `backend-laravel/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: relay-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: relay
      POSTGRES_USER: relay
      POSTGRES_PASSWORD: relay
    ports:
      - "5432:5432"
    volumes:
      - relay-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U relay -d relay"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  relay-pgdata:
```

Port 5432 was confirmed free.

- [ ] **Step 5: Start Postgres and wait for health**

```bash
cd backend-laravel
docker compose up -d
until [ "$(docker inspect -f '{{.State.Health.Status}}' relay-postgres)" = "healthy" ]; do sleep 1; done
echo "postgres healthy"
```

Expected: `postgres healthy`

- [ ] **Step 6: Point the app at Postgres**

Set these in `backend-laravel/.env`:

```dotenv
APP_NAME=Relay
APP_URL=http://localhost:8000

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=relay
DB_USERNAME=relay
DB_PASSWORD=relay
```

Create `backend-laravel/.env.testing` with the same values but `DB_DATABASE=relay_test`, so tests never touch development data. Decision 0004 requires tests run on Postgres too.

```bash
docker exec relay-postgres createdb -U relay relay_test
```

- [ ] **Step 7: Migrate and verify the connection is real**

```bash
php artisan migrate
php artisan db:show --counts
```

Expected: `php artisan db:show` reports connection `pgsql`, database `relay`, and lists the default tables with row counts. If it reports `sqlite`, the `.env` change did not take. Run `php artisan config:clear` and retry.

- [ ] **Step 8: Serve it and look at it**

```bash
composer dev
```

Open `http://localhost:8000`. Register an account through the starter kit UI and confirm you reach the dashboard. This proves the database round trip works end to end, not just that migrations ran.

Stop the processes when done.

- [ ] **Step 9: Commit**

```bash
cd backend-laravel
git init -b main
git add -A
git commit -m "Add Laravel 13 application with React starter kit and Postgres

Scaffolded with the official React starter kit: Inertia, React 19,
TypeScript, Tailwind and shadcn/ui. Postgres runs in Docker rather than
the framework's SQLite default because this app runs a web process, a
queue worker and a websocket server concurrently, and SQLite's single
writer model produces lock contention that no deployed Laravel app has.
See decision 0004.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

- [ ] **Step 10: Hand Rauf the push commands**

The agent does not run these. Print them for Rauf:

```bash
cd /Users/apple/work/app-development/backend-laravel
gh repo create raufkhandevs/relay-laravel --public \
  --description "Relay support desk backend: Laravel 13, Inertia, Reverb"
git remote add origin https://github.com/raufkhandevs/relay-laravel.git
git push -u origin main
```

Wait for Rauf to confirm the push landed before step 11. `git submodule add` against a repo with zero commits fails, because there is no default branch to track.

- [ ] **Step 11: Register the submodule in the parent**

```bash
cd /Users/apple/work/app-development
git rm -r --cached backend-laravel 2>/dev/null || true
git submodule add https://github.com/raufkhandevs/relay-laravel.git backend-laravel
git add .gitmodules backend-laravel
git commit -m "Add backend-laravel as a submodule

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

Verify `.gitmodules` contains the public HTTPS URL and not the `github.com-rauf` alias:

```bash
grep url .gitmodules
```

Expected: `url = https://github.com/raufkhandevs/relay-laravel.git`

Then hand Rauf: `cd /Users/apple/work/app-development && git push`

- [ ] **Step 12: Move the docs into the parent's tracked tree**

Nothing to do. `docs/` already lives in the parent repo and stays there. Decision 0008 was amended for this.

---

### Task 2: Enums, schema and models

**Files:**
- Create: `app/Enums/UserRole.php`, `app/Enums/TicketStatus.php`
- Create: `database/migrations/*_add_role_to_users_table.php`
- Create: `database/migrations/*_create_tickets_table.php`
- Create: `database/migrations/*_create_messages_table.php`
- Modify: `app/Models/User.php`
- Create: `app/Models/Ticket.php`, `app/Models/Message.php`
- Create: `database/factories/TicketFactory.php`, `database/factories/MessageFactory.php`
- Test: `tests/Feature/SchemaTest.php`

**Interfaces:**
- Consumes: the Laravel application from Task 1.
- Produces: `UserRole::Customer`, `UserRole::Agent`; `TicketStatus::Open|Pending|Resolved|Closed`; `Ticket` with `customer()`, `assignedAgent()`, `messages()`; `Message` with `ticket()`, `author()`; `User` with `role`, `tickets()`. Factories `Ticket::factory()` and `Message::factory()`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/SchemaTest.php`:

```php
<?php

use App\Enums\TicketStatus;
use App\Enums\UserRole;
use App\Models\Message;
use App\Models\Ticket;
use App\Models\User;

it('relates a ticket to its customer, agent and messages', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $agent = User::factory()->create(['role' => UserRole::Agent]);

    $ticket = Ticket::factory()->for($customer, 'customer')->create([
        'assigned_agent_id' => $agent->id,
        'status' => TicketStatus::Open,
    ]);

    Message::factory()->count(3)->for($ticket)->for($customer, 'author')->create();

    expect($ticket->customer->is($customer))->toBeTrue()
        ->and($ticket->assignedAgent->is($agent))->toBeTrue()
        ->and($ticket->messages)->toHaveCount(3)
        ->and($ticket->status)->toBeInstanceOf(TicketStatus::class)
        ->and($customer->role)->toBe(UserRole::Customer);
});

it('rejects a duplicate idempotency key', function () {
    $ticket = Ticket::factory()->create();

    Message::factory()->for($ticket)->create(['idempotency_key' => 'abc-123']);

    expect(fn () => Message::factory()->for($ticket)->create(['idempotency_key' => 'abc-123']))
        ->toThrow(Illuminate\Database\UniqueConstraintViolationException::class);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
php artisan test --filter=SchemaTest
```

Expected: FAIL, `Class "App\Enums\UserRole" not found`.

- [ ] **Step 3: Write the enums**

`app/Enums/UserRole.php`:

```php
<?php

namespace App\Enums;

enum UserRole: string
{
    case Customer = 'customer';
    case Agent = 'agent';
}
```

`app/Enums/TicketStatus.php`:

```php
<?php

namespace App\Enums;

enum TicketStatus: string
{
    case Open = 'open';
    case Pending = 'pending';
    case Resolved = 'resolved';
    case Closed = 'closed';
}
```

These enums are the only place these strings are spelled. A status is an enum rather than a pair of booleans because two booleans can express "open and resolved", which is a state the product does not have and would otherwise need defending against in code.

- [ ] **Step 4: Write the migrations**

```bash
php artisan make:migration add_role_to_users_table
php artisan make:migration create_tickets_table
php artisan make:migration create_messages_table
```

`add_role_to_users_table`:

```php
public function up(): void
{
    Schema::table('users', function (Blueprint $table) {
        $table->string('role')->default('customer')->index();
    });
}

public function down(): void
{
    Schema::table('users', fn (Blueprint $table) => $table->dropColumn('role'));
}
```

`create_tickets_table`:

```php
public function up(): void
{
    Schema::create('tickets', function (Blueprint $table) {
        $table->id();
        $table->string('subject');
        $table->string('status')->default('open')->index();
        $table->foreignId('customer_id')->constrained('users')->cascadeOnDelete();
        $table->foreignId('assigned_agent_id')->nullable()->constrained('users')->nullOnDelete();
        $table->timestamp('last_message_at')->nullable();
        $table->timestamps();

        $table->index(['last_message_at' => 'desc']);
    });
}

public function down(): void
{
    Schema::dropIfExists('tickets');
}
```

The descending index on `last_message_at` is the entire reason that column exists. Without it the denormalisation buys nothing. See decision 0005.

`create_messages_table`:

```php
public function up(): void
{
    Schema::create('messages', function (Blueprint $table) {
        $table->id();
        $table->foreignId('ticket_id')->constrained()->cascadeOnDelete();
        $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
        $table->text('body');
        $table->uuid('idempotency_key')->nullable()->unique();
        $table->timestamps();

        $table->index(['ticket_id', 'id']);
    });
}

public function down(): void
{
    Schema::dropIfExists('messages');
}
```

The `(ticket_id, id)` index serves cursor pagination, which orders by `id` within a ticket.

- [ ] **Step 5: Write the models**

`app/Models/Ticket.php`:

```php
<?php

namespace App\Models;

use App\Enums\TicketStatus;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Ticket extends Model
{
    use HasFactory;

    protected $fillable = ['subject', 'status', 'customer_id', 'assigned_agent_id', 'last_message_at'];

    protected function casts(): array
    {
        return [
            'status' => TicketStatus::class,
            'last_message_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function assignedAgent(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_agent_id');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }
}
```

`app/Models/Message.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Message extends Model
{
    use HasFactory;

    protected $fillable = ['ticket_id', 'user_id', 'body', 'idempotency_key'];

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(Ticket::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
```

In `app/Models/User.php`, add `'role'` to `$fillable` and add to the `casts()` method:

```php
'role' => UserRole::class,
```

Add the relationship:

```php
public function tickets(): HasMany
{
    return $this->hasMany(Ticket::class, 'customer_id');
}
```

- [ ] **Step 6: Write the factories**

```bash
php artisan make:factory TicketFactory --model=Ticket
php artisan make:factory MessageFactory --model=Message
```

`TicketFactory::definition()`:

```php
return [
    'subject' => fake()->sentence(4),
    'status' => TicketStatus::Open,
    'customer_id' => User::factory()->state(['role' => UserRole::Customer]),
    'assigned_agent_id' => null,
    'last_message_at' => null,
];
```

`MessageFactory::definition()`:

```php
return [
    'ticket_id' => Ticket::factory(),
    'user_id' => User::factory(),
    'body' => fake()->paragraph(),
    'idempotency_key' => null,
];
```

- [ ] **Step 7: Run the tests and watch them pass**

```bash
php artisan migrate --env=testing
php artisan test --filter=SchemaTest
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add ticket and message schema with backed enums

One users table with a role enum rather than separate customer and agent
tables: being an agent is a role a person holds, not a different kind of
entity, and splitting it would duplicate auth and profile for no gain.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 3: MessageObserver, the single writer of last_message_at

**Files:**
- Create: `app/Observers/MessageObserver.php`
- Modify: `app/Models/Message.php` (attribute)
- Test: `tests/Feature/LastMessageAtTest.php`

**Interfaces:**
- Consumes: `Ticket`, `Message` from Task 2.
- Produces: `tickets.last_message_at` is maintained automatically on message creation. Nothing else writes it.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/LastMessageAtTest.php`:

```php
<?php

use App\Models\Message;
use App\Models\Ticket;

it('stamps last_message_at on the parent ticket when a message is created', function () {
    $ticket = Ticket::factory()->create(['last_message_at' => null]);

    $message = Message::factory()->for($ticket)->create();

    expect($ticket->fresh()->last_message_at->timestamp)
        ->toBe($message->created_at->timestamp);
});

it('advances last_message_at on each new message', function () {
    $ticket = Ticket::factory()->create();

    Message::factory()->for($ticket)->create(['created_at' => now()->subHour()]);
    $first = $ticket->fresh()->last_message_at;

    Message::factory()->for($ticket)->create();

    expect($ticket->fresh()->last_message_at->greaterThan($first))->toBeTrue();
});

it('orders tickets by most recent activity using the denormalised column', function () {
    $quiet = Ticket::factory()->create();
    $busy = Ticket::factory()->create();

    Message::factory()->for($quiet)->create(['created_at' => now()->subDay()]);
    Message::factory()->for($busy)->create();

    $ordered = Ticket::orderByDesc('last_message_at')->pluck('id');

    expect($ordered->first())->toBe($busy->id);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
php artisan test --filter=LastMessageAtTest
```

Expected: FAIL, `Attempt to read property "timestamp" on null`.

- [ ] **Step 3: Write the observer**

`app/Observers/MessageObserver.php`:

```php
<?php

namespace App\Observers;

use App\Models\Message;

class MessageObserver
{
    public function created(Message $message): void
    {
        $message->ticket()->update(['last_message_at' => $message->created_at]);
    }
}
```

Attach it by attribute on the model. Add above the `Message` class declaration in `app/Models/Message.php`:

```php
use App\Observers\MessageObserver;
use Illuminate\Database\Eloquent\Attributes\ObservedBy;

#[ObservedBy(MessageObserver::class)]
class Message extends Model
```

This observer is the only code permitted to write `last_message_at`. Decision 0005 depends on there being exactly one writer; a second one reintroduces the drift the decision accepts as contained.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
php artisan test --filter=LastMessageAtTest
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Maintain tickets.last_message_at from a single observer

The agent queue sorts by most recent activity, which is the hottest read
in the app. Deriving it from max(messages.created_at) cannot use an index
on tickets, so it aggregates the messages table on every queue load. One
cheap write per message buys an indexed read. See decision 0005.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 4: TicketPolicy

**Files:**
- Create: `app/Policies/TicketPolicy.php`
- Test: `tests/Feature/TicketPolicyTest.php`

**Interfaces:**
- Consumes: `User`, `Ticket`, `UserRole` from Task 2.
- Produces: `TicketPolicy::view(User, Ticket): bool` and `TicketPolicy::reply(User, Ticket): bool`. Called as `$user->can('view', $ticket)` everywhere, including `routes/channels.php` in Task 7. No `create` method: nothing in 1A creates a ticket outside the seeder, and a policy method with no caller is dead code. It arrives with `POST /api/tickets` in slice 2.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/TicketPolicyTest.php`:

```php
<?php

use App\Enums\UserRole;
use App\Models\Ticket;
use App\Models\User;

beforeEach(function () {
    $this->customer = User::factory()->create(['role' => UserRole::Customer]);
    $this->stranger = User::factory()->create(['role' => UserRole::Customer]);
    $this->agent = User::factory()->create(['role' => UserRole::Agent]);
    $this->ticket = Ticket::factory()->for($this->customer, 'customer')->create();
});

it('lets the owning customer view their ticket', function () {
    expect($this->customer->can('view', $this->ticket))->toBeTrue();
});

it('lets any agent view any ticket', function () {
    expect($this->agent->can('view', $this->ticket))->toBeTrue();
});

it('refuses another customer', function () {
    expect($this->stranger->can('view', $this->ticket))->toBeFalse();
});

it('lets the owning customer and any agent reply', function () {
    expect($this->customer->can('reply', $this->ticket))->toBeTrue()
        ->and($this->agent->can('reply', $this->ticket))->toBeTrue()
        ->and($this->stranger->can('reply', $this->ticket))->toBeFalse();
});

```

- [ ] **Step 2: Run it and watch it fail**

```bash
php artisan test --filter=TicketPolicyTest
```

Expected: FAIL, all four, because no policy exists so `can()` returns false.

- [ ] **Step 3: Write the policy**

```bash
php artisan make:policy TicketPolicy --model=Ticket
```

Replace the generated body:

```php
<?php

namespace App\Policies;

use App\Enums\UserRole;
use App\Models\Ticket;
use App\Models\User;

class TicketPolicy
{
    public function view(User $user, Ticket $ticket): bool
    {
        return $user->role === UserRole::Agent
            || $ticket->customer_id === $user->id;
    }

    public function reply(User $user, Ticket $ticket): bool
    {
        return $this->view($user, $ticket);
    }
}
```

Laravel 13 discovers policies by naming convention, so no registration is needed. Confirm discovery works rather than assuming it in step 4.

`reply` delegates to `view` rather than repeating the rule. When reply rules diverge later, that is a deliberate edit in one place.

- [ ] **Step 4: Run the tests and watch them pass**

```bash
php artisan test --filter=TicketPolicyTest
```

Expected: PASS, 4 tests. If every test still fails, policy auto-discovery did not find the class. Register it explicitly with `Gate::policy(Ticket::class, TicketPolicy::class)` in `AppServiceProvider::boot()` and note that in the commit body.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add TicketPolicy as the single authorisation rule for tickets

This policy is called by HTTP routes and by channel authorisation in
routes/channels.php. A websocket channel is an authorisation surface that
is easy to forget, and an HTTP endpoint can be correctly locked down while
its private channel stays subscribable by any authenticated user. Deriving
both from one policy makes that failure structurally hard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 5: Sanctum API, data objects, tickets endpoints

**Files:**
- Create: `app/Data/{UserData,TicketData,MessageData}.php`
- Create: `app/Http/Controllers/Api/{TokenController,TicketController}.php`
- Modify: `bootstrap/app.php`
- Modify: `routes/api.php`
- Test: `tests/Feature/Api/{TokenTest,TicketApiTest}.php`

**Interfaces:**
- Consumes: `TicketPolicy` from Task 4, models from Task 2.
- Produces: `POST /api/tokens`, `DELETE /api/tokens/current`, `GET /api/me`, `GET /api/tickets`, `GET /api/tickets/{ticket}`. Data classes `UserData::from(User)`, `TicketData::from(Ticket)`, `MessageData::from(Message)`.

- [ ] **Step 1: Install Sanctum and the data package**

```bash
php artisan install:api
composer require spatie/laravel-data
```

`install:api` publishes Sanctum's migration and creates `routes/api.php`. Run the migration:

```bash
php artisan migrate
php artisan migrate --env=testing
```

`spatie/laravel-data` is a deliberate new dependency. Decision 0006 records why: three TypeScript clients consume this PHP API, so the response shape needs one source of truth that can emit types.

- [ ] **Step 2: Enable stateful API requests and authorisation on controllers**

In `bootstrap/app.php`, inside `withMiddleware`:

```php
->withMiddleware(function (Middleware $middleware): void {
    $middleware->statefulApi();
})
```

This is what lets `auth:sanctum` accept a session cookie from the Inertia web client on the same routes that accept a bearer token from the native clients. Without it, only tokens work.

Then add the authorisation trait to the base controller. Since Laravel 11 the generated `app/Http/Controllers/Controller.php` is a bare abstract class with no traits, so `$this->authorize()` does not exist and every call site fatals with `Call to undefined method`. Every controller in this plan calls it.

```php
<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;

abstract class Controller
{
    use AuthorizesRequests;
}
```

Confirm before continuing:

```bash
grep -n AuthorizesRequests app/Http/Controllers/Controller.php
```

Expected: two lines, the import and the `use` statement.

- [ ] **Step 3: Write the failing test**

Create `tests/Feature/Api/TokenTest.php`:

```php
<?php

use App\Models\User;

it('issues a token for correct credentials', function () {
    $user = User::factory()->create(['password' => bcrypt('correct-horse')]);

    $response = $this->postJson('/api/tokens', [
        'email' => $user->email,
        'password' => 'correct-horse',
        'device_name' => 'iPhone 17 Simulator',
    ]);

    $response->assertOk()->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'role']]);
    expect($user->fresh()->tokens)->toHaveCount(1);
});

it('refuses wrong credentials', function () {
    $user = User::factory()->create(['password' => bcrypt('correct-horse')]);

    $this->postJson('/api/tokens', [
        'email' => $user->email,
        'password' => 'wrong',
        'device_name' => 'iPhone 17 Simulator',
    ])->assertStatus(422);
});

it('revokes only the current token on logout', function () {
    $user = User::factory()->create();
    $keep = $user->createToken('desktop')->plainTextToken;
    $drop = $user->createToken('phone')->plainTextToken;

    $this->withHeader('Authorization', "Bearer {$drop}")
        ->deleteJson('/api/tokens/current')
        ->assertNoContent();

    expect($user->fresh()->tokens)->toHaveCount(1)
        ->and($user->fresh()->tokens->first()->name)->toBe('desktop');
});
```

Signing out on the phone must not sign the user out on the desktop. That is what the third test pins down.

- [ ] **Step 4: Run it and watch it fail**

```bash
php artisan test --filter=TokenTest
```

Expected: FAIL, 404 on `/api/tokens`.

- [ ] **Step 5: Write the data objects**

`app/Data/UserData.php`:

```php
<?php

namespace App\Data;

use App\Enums\UserRole;
use App\Models\User;
use Spatie\LaravelData\Data;

class UserData extends Data
{
    public function __construct(
        public int $id,
        public string $name,
        public string $email,
        public UserRole $role,
    ) {}

    public static function fromModel(User $user): self
    {
        return new self($user->id, $user->name, $user->email, $user->role);
    }
}
```

`app/Data/MessageData.php`:

```php
<?php

namespace App\Data;

use App\Models\Message;
use Carbon\CarbonImmutable;
use Spatie\LaravelData\Data;

class MessageData extends Data
{
    public function __construct(
        public int $id,
        public int $ticket_id,
        public string $body,
        public UserData $author,
        public CarbonImmutable $created_at,
    ) {}

    public static function fromModel(Message $message): self
    {
        return new self(
            $message->id,
            $message->ticket_id,
            $message->body,
            UserData::fromModel($message->author),
            $message->created_at->toImmutable(),
        );
    }
}
```

`app/Data/TicketData.php`:

```php
<?php

namespace App\Data;

use App\Enums\TicketStatus;
use App\Models\Ticket;
use Carbon\CarbonImmutable;
use Spatie\LaravelData\Data;

class TicketData extends Data
{
    public function __construct(
        public int $id,
        public string $subject,
        public TicketStatus $status,
        public UserData $customer,
        public ?UserData $assigned_agent,
        public ?CarbonImmutable $last_message_at,
        public CarbonImmutable $created_at,
    ) {}

    public static function fromModel(Ticket $ticket): self
    {
        return new self(
            $ticket->id,
            $ticket->subject,
            $ticket->status,
            UserData::fromModel($ticket->customer),
            $ticket->assignedAgent ? UserData::fromModel($ticket->assignedAgent) : null,
            $ticket->last_message_at?->toImmutable(),
            $ticket->created_at->toImmutable(),
        );
    }
}
```

Timestamps are `CarbonImmutable` and serialise as ISO 8601 in UTC. Clients convert at the edge.

- [ ] **Step 6: Write the token controller**

`app/Http/Controllers/Api/TokenController.php`:

```php
<?php

namespace App\Http\Controllers\Api;

use App\Data\UserData;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class TokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'device_name' => ['required', 'string', 'max:255'],
        ]);

        $user = User::where('email', $validated['email'])->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        return response()->json([
            'token' => $user->createToken($validated['device_name'])->plainTextToken,
            'user' => UserData::fromModel($user),
        ]);
    }

    public function destroy(Request $request): Response
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }
}
```

The failure message is identical whether the email is unknown or the password is wrong. Distinguishing them tells an attacker which emails have accounts.

- [ ] **Step 7: Write the ticket controller**

`app/Http/Controllers/Api/TicketController.php`:

```php
<?php

namespace App\Http\Controllers\Api;

use App\Data\TicketData;
use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Models\Ticket;
use Illuminate\Http\Request;

class TicketController extends Controller
{
    public function index(Request $request)
    {
        $tickets = Ticket::query()
            ->with(['customer', 'assignedAgent'])
            ->when(
                $request->user()->role === UserRole::Customer,
                fn ($query) => $query->where('customer_id', $request->user()->id),
            )
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->paginate(20);

        return TicketData::collect($tickets);
    }

    public function show(Request $request, Ticket $ticket): TicketData
    {
        $this->authorize('view', $ticket);

        return TicketData::fromModel($ticket->load(['customer', 'assignedAgent']));
    }
}
```

`index` scopes by role in the query rather than filtering after fetching. Filtering after fetching means the rows were already read, which is both slower and a leak waiting to happen if the filter is ever skipped.

The secondary `orderByDesc('id')` gives a deterministic order for tickets with no messages, where `last_message_at` is null.

- [ ] **Step 8: Register the routes**

In `routes/api.php`:

```php
<?php

use App\Http\Controllers\Api\TicketController;
use App\Http\Controllers\Api\TokenController;
use Illuminate\Support\Facades\Route;

Route::post('/tokens', [TokenController::class, 'store']);

Route::middleware('auth:sanctum')->group(function () {
    Route::delete('/tokens/current', [TokenController::class, 'destroy']);

    Route::get('/me', fn (Illuminate\Http\Request $request) => App\Data\UserData::fromModel($request->user()));

    Route::get('/tickets', [TicketController::class, 'index']);
    Route::get('/tickets/{ticket}', [TicketController::class, 'show']);
});
```

- [ ] **Step 9: Write the authorisation test**

Create `tests/Feature/Api/TicketApiTest.php`:

```php
<?php

use App\Enums\UserRole;
use App\Models\Ticket;
use App\Models\User;

it('shows a customer only their own tickets', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $stranger = User::factory()->create(['role' => UserRole::Customer]);

    Ticket::factory()->count(2)->for($customer, 'customer')->create();
    Ticket::factory()->count(3)->for($stranger, 'customer')->create();

    $response = $this->actingAs($customer, 'sanctum')->getJson('/api/tickets');

    $response->assertOk();
    expect($response->json('data'))->toHaveCount(2);
});

it('shows an agent every ticket', function () {
    $agent = User::factory()->create(['role' => UserRole::Agent]);
    Ticket::factory()->count(5)->create();

    $response = $this->actingAs($agent, 'sanctum')->getJson('/api/tickets');

    expect($response->json('data'))->toHaveCount(5);
});

it('refuses a stranger reading another customers ticket', function () {
    $stranger = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->create();

    $this->actingAs($stranger, 'sanctum')
        ->getJson("/api/tickets/{$ticket->id}")
        ->assertForbidden();
});

it('refuses an unauthenticated request', function () {
    $ticket = Ticket::factory()->create();

    $this->getJson("/api/tickets/{$ticket->id}")->assertUnauthorized();
});

it('paginates the ticket list', function () {
    $agent = User::factory()->create(['role' => UserRole::Agent]);
    Ticket::factory()->count(25)->create();

    $response = $this->actingAs($agent, 'sanctum')->getJson('/api/tickets');

    expect($response->json('data'))->toHaveCount(20)
        ->and($response->json('meta.total'))->toBe(25);
});
```

The third test is the IDOR test. It is the most valuable test in this task.

- [ ] **Step 10: Run the tests and watch them pass**

```bash
php artisan test --filter="TokenTest|TicketApiTest"
```

Expected: PASS, 8 tests.

- [ ] **Step 11: Verify it by hand, not only by test**

```bash
composer dev
```

In another terminal, seed a user and exercise the real HTTP path:

```bash
php artisan tinker --execute="App\Models\User::factory()->create(['email' => 'agent@relay.test', 'password' => bcrypt('password'), 'role' => 'agent']);"

TOKEN=$(curl -s -X POST http://localhost:8000/api/tokens \
  -H "Accept: application/json" \
  -d "email=agent@relay.test&password=password&device_name=curl" | php -r 'echo json_decode(file_get_contents("php://stdin"))->token;')

curl -s http://localhost:8000/api/tickets -H "Accept: application/json" -H "Authorization: Bearer $TOKEN" | head -c 400
```

Expected: a JSON payload with `data` and `meta` keys. This proves the token round trip works over real HTTP, which `actingAs` does not.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Add Sanctum token auth and ticket API with data objects

statefulApi() lets auth:sanctum accept a session cookie from the Inertia
web client on the same routes that accept a bearer token from the native
clients, so one set of endpoints serves all three. Responses are
spatie/laravel-data objects because three TypeScript clients consume this
API and the shape needs one source of truth. See decisions 0003 and 0006.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 6: Messages, cursor pagination and idempotency

**Files:**
- Create: `app/Http/Controllers/Api/MessageController.php`
- Create: `app/Http/Requests/StoreMessageRequest.php`
- Modify: `routes/api.php`
- Test: `tests/Feature/Api/MessageApiTest.php`

**Interfaces:**
- Consumes: `TicketPolicy`, `MessageData`, models.
- Produces: `GET /api/tickets/{ticket}/messages` returning a cursor-paginated payload with a `next_cursor`, and `POST /api/tickets/{ticket}/messages` accepting `body` and `idempotency_key`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/Api/MessageApiTest.php`:

```php
<?php

use App\Enums\UserRole;
use App\Models\Message;
use App\Models\Ticket;
use App\Models\User;
use Illuminate\Support\Str;

it('cursor paginates message history', function () {
    $agent = User::factory()->create(['role' => UserRole::Agent]);
    $ticket = Ticket::factory()->create();
    Message::factory()->count(30)->for($ticket)->create();

    $first = $this->actingAs($agent, 'sanctum')
        ->getJson("/api/tickets/{$ticket->id}/messages");

    $first->assertOk();
    expect($first->json('data'))->toHaveCount(20)
        ->and($first->json('meta.next_cursor'))->not->toBeNull();

    $cursor = $first->json('meta.next_cursor');
    $second = $this->actingAs($agent, 'sanctum')
        ->getJson("/api/tickets/{$ticket->id}/messages?cursor={$cursor}");

    expect($second->json('data'))->toHaveCount(10);

    $firstIds = collect($first->json('data'))->pluck('id');
    $secondIds = collect($second->json('data'))->pluck('id');
    expect($firstIds->intersect($secondIds))->toBeEmpty();
});

it('posts a message and stamps the ticket', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create(['last_message_at' => null]);

    $response = $this->actingAs($customer, 'sanctum')
        ->postJson("/api/tickets/{$ticket->id}/messages", [
            'body' => 'The export still fails.',
            'idempotency_key' => (string) Str::uuid(),
        ]);

    $response->assertCreated()->assertJsonPath('body', 'The export still fails.');
    expect($ticket->fresh()->last_message_at)->not->toBeNull();
});

it('returns the original message for a repeated idempotency key', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create();
    $key = (string) Str::uuid();

    $first = $this->actingAs($customer, 'sanctum')
        ->postJson("/api/tickets/{$ticket->id}/messages", ['body' => 'Once', 'idempotency_key' => $key]);

    $second = $this->actingAs($customer, 'sanctum')
        ->postJson("/api/tickets/{$ticket->id}/messages", ['body' => 'Once', 'idempotency_key' => $key]);

    expect($second->json('id'))->toBe($first->json('id'))
        ->and(Message::where('ticket_id', $ticket->id)->count())->toBe(1);
});

it('refuses a stranger posting to a ticket', function () {
    $stranger = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->create();

    $this->actingAs($stranger, 'sanctum')
        ->postJson("/api/tickets/{$ticket->id}/messages", [
            'body' => 'let me in',
            'idempotency_key' => (string) Str::uuid(),
        ])
        ->assertForbidden();
});
```

The first test asserts the two pages do not overlap. That is the property offset pagination loses on a live conversation, and it is the reason for cursor pagination.

- [ ] **Step 2: Run it and watch it fail**

```bash
php artisan test --filter=MessageApiTest
```

Expected: FAIL, 404.

- [ ] **Step 3: Write the form request**

`app/Http/Requests/StoreMessageRequest.php`:

```php
<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreMessageRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'max:5000'],
            'idempotency_key' => ['required', 'uuid'],
        ];
    }
}
```

- [ ] **Step 4: Write the controller**

`app/Http/Controllers/Api/MessageController.php`:

```php
<?php

namespace App\Http\Controllers\Api;

use App\Data\MessageData;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreMessageRequest;
use App\Models\Message;
use App\Models\Ticket;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    public function index(Request $request, Ticket $ticket)
    {
        $this->authorize('view', $ticket);

        $messages = $ticket->messages()
            ->with('author')
            ->orderByDesc('id')
            ->cursorPaginate(20);

        return MessageData::collect($messages);
    }

    public function store(StoreMessageRequest $request, Ticket $ticket): JsonResponse
    {
        $this->authorize('reply', $ticket);

        $existing = Message::where('idempotency_key', $request->validated('idempotency_key'))->first();

        if ($existing) {
            return response()->json(
                MessageData::fromModel($existing->load('author')),
                JsonResponse::HTTP_CREATED,
            );
        }

        $message = $ticket->messages()->create([
            'user_id' => $request->user()->id,
            'body' => $request->validated('body'),
            'idempotency_key' => $request->validated('idempotency_key'),
        ]);

        return response()->json(
            MessageData::fromModel($message->load('author')),
            JsonResponse::HTTP_CREATED,
        );
    }
}
```

The repeat returns 201 with the original message rather than an error. A client that retried after a dropped response cannot tell the difference between the first and second attempt, and should not have to.

- [ ] **Step 5: Register the routes**

Inside the existing `auth:sanctum` group in `routes/api.php`:

```php
Route::get('/tickets/{ticket}/messages', [MessageController::class, 'index']);
Route::post('/tickets/{ticket}/messages', [MessageController::class, 'store']);
```

- [ ] **Step 6: Run the tests and watch them pass**

```bash
php artisan test --filter=MessageApiTest
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add message endpoints with cursor pagination and idempotency

Message history uses cursorPaginate because offset paging assumes a stable
result set and a live conversation is not one: messages arriving mid scroll
shift every row, so pages duplicate and skip as a matter of course. Writes
require a client generated idempotency key because mobile networks drop
responses as readily as requests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 7: Reverb, the MessageCreated event, and channel authorisation

**Files:**
- Create: `app/Events/MessageCreated.php`
- Modify: `app/Http/Controllers/Api/MessageController.php`
- Modify: `routes/channels.php`
- Modify: `bootstrap/app.php`
- Test: `tests/Feature/BroadcastAuthTest.php`, `tests/Feature/MessageBroadcastTest.php`

**Interfaces:**
- Consumes: `TicketPolicy`, `MessageData`, `Message`.
- Produces: `MessageCreated` broadcasting on `private-ticket.{id}` as `message.created` with a `MessageData` payload. `POST /api/broadcasting/auth` accepting both a session cookie and a bearer token.

- [ ] **Step 1: Install Reverb**

```bash
php artisan install:broadcasting --reverb
```

This installs the Composer and npm packages and writes the Reverb environment variables. Confirm `.env` now has `BROADCAST_CONNECTION=reverb` plus `REVERB_APP_KEY`, `REVERB_APP_SECRET`, `REVERB_APP_ID`, and the `VITE_REVERB_*` mirrors.

Copy the `REVERB_*` and `VITE_REVERB_*` values into `.env.testing` as well, or broadcast tests will fail on missing configuration.

- [ ] **Step 2: Point broadcasting auth at the Sanctum guard**

In `bootstrap/app.php`, add `withBroadcasting` to the application configuration:

```php
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
```

This puts channel authorisation at `POST /api/broadcasting/auth` behind `auth:sanctum`. Combined with `statefulApi()` from Task 5, that one endpoint accepts a session cookie from the web client and a bearer token from the native clients. This is the design in decision 0003, and step 5 tests both credentials against it rather than assuming.

- [ ] **Step 3: Write the failing channel authorisation test**

Create `tests/Feature/BroadcastAuthTest.php`:

```php
<?php

use App\Enums\UserRole;
use App\Models\Ticket;
use App\Models\User;

it('authorises the owning customer on their ticket channel', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create();

    $this->actingAs($customer, 'sanctum')
        ->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => "private-ticket.{$ticket->id}",
        ])
        ->assertOk();
});

it('authorises any agent on any ticket channel', function () {
    $agent = User::factory()->create(['role' => UserRole::Agent]);
    $ticket = Ticket::factory()->create();

    $this->actingAs($agent, 'sanctum')
        ->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => "private-ticket.{$ticket->id}",
        ])
        ->assertOk();
});

it('refuses a stranger subscribing to a ticket channel', function () {
    $stranger = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->create();

    $this->actingAs($stranger, 'sanctum')
        ->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => "private-ticket.{$ticket->id}",
        ])
        ->assertForbidden();
});

it('accepts a real bearer token on the same endpoint', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create();
    $token = $customer->createToken('iPhone')->plainTextToken;

    $this->withHeader('Authorization', "Bearer {$token}")
        ->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => "private-ticket.{$ticket->id}",
        ])
        ->assertOk();
});

it('refuses an unauthenticated subscription', function () {
    $ticket = Ticket::factory()->create();

    $this->postJson('/api/broadcasting/auth', [
        'socket_id' => '1234.5678',
        'channel_name' => "private-ticket.{$ticket->id}",
    ])->assertUnauthorized();
});
```

The third test is the one that matters most in this entire plan. An HTTP endpoint can be correctly locked down while its private channel stays open to any authenticated user, and no HTTP test catches that. This test does.

The fourth test uses a real token rather than `actingAs`, because `actingAs` bypasses the guard resolution that is the thing under test here.

- [ ] **Step 4: Run it and watch it fail**

```bash
php artisan test --filter=BroadcastAuthTest
```

Expected: FAIL, 403 or 404 on every test, because `routes/channels.php` has no matching channel.

- [ ] **Step 5: Write the channel authorisation**

Replace `routes/channels.php`:

```php
<?php

use App\Models\Ticket;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('ticket.{ticket}', function (User $user, Ticket $ticket) {
    return $user->can('view', $ticket);
});
```

Route model binding resolves `{ticket}` to a `Ticket`, and the callback delegates straight to `TicketPolicy`. The rule is not repeated here. If the policy changes, channel authorisation changes with it, which is the whole point of decision 0004's structure.

- [ ] **Step 6: Run the tests and watch them pass**

```bash
php artisan test --filter=BroadcastAuthTest
```

Expected: PASS, 5 tests.

- [ ] **Step 7: Write the failing broadcast test**

Create `tests/Feature/MessageBroadcastTest.php`:

```php
<?php

use App\Events\MessageCreated;
use App\Enums\UserRole;
use App\Models\Ticket;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;

it('broadcasts MessageCreated on the ticket channel when a message is posted', function () {
    Event::fake([MessageCreated::class]);

    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create();

    $this->actingAs($customer, 'sanctum')
        ->postJson("/api/tickets/{$ticket->id}/messages", [
            'body' => 'Still broken.',
            'idempotency_key' => (string) Str::uuid(),
        ])
        ->assertCreated();

    Event::assertDispatched(MessageCreated::class, function (MessageCreated $event) use ($ticket) {
        return $event->message->ticket_id === $ticket->id
            && $event->broadcastOn()[0]->name === "private-ticket.{$ticket->id}";
    });
});

it('does not broadcast twice for a repeated idempotency key', function () {
    Event::fake([MessageCreated::class]);

    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create();
    $key = (string) Str::uuid();

    foreach ([1, 2] as $attempt) {
        $this->actingAs($customer, 'sanctum')
            ->postJson("/api/tickets/{$ticket->id}/messages", ['body' => 'Once', 'idempotency_key' => $key]);
    }

    Event::assertDispatchedTimes(MessageCreated::class, 1);
});
```

The second test matters: a retry that returns the original message must not also push a duplicate into every connected client.

- [ ] **Step 8: Run it and watch it fail**

```bash
php artisan test --filter=MessageBroadcastTest
```

Expected: FAIL, `Class "App\Events\MessageCreated" not found`.

- [ ] **Step 9: Write the event**

```bash
php artisan make:event MessageCreated
```

`app/Events/MessageCreated.php`:

```php
<?php

namespace App\Events;

use App\Data\MessageData;
use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MessageCreated implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Message $message) {}

    /** @return array<int, PrivateChannel> */
    public function broadcastOn(): array
    {
        return [new PrivateChannel("ticket.{$this->message->ticket_id}")];
    }

    public function broadcastAs(): string
    {
        return 'message.created';
    }

    /** @return array<string, mixed> */
    public function broadcastWith(): array
    {
        return MessageData::fromModel($this->message->load('author'))->toArray();
    }
}
```

`broadcastWith` reuses `MessageData`, so the websocket payload and the HTTP response are the same shape. A client can use one parser for both, and the generated TypeScript covers both.

- [ ] **Step 10: Dispatch it from the controller**

In `MessageController::store`, after creating the message and before returning, add:

```php
MessageCreated::dispatch($message);
```

It goes after the idempotency early return, so a repeat does not dispatch. Import `App\Events\MessageCreated` at the top of the file.

- [ ] **Step 11: Run the tests and watch them pass**

```bash
php artisan test --filter=MessageBroadcastTest
php artisan test
```

Expected: both green. The React starter kit ships its own test suite alongside the tests in this plan, so do not assert a specific total; assert that nothing is red.

- [ ] **Step 12: Watch a real message cross a real websocket**

Tests with `Event::fake` prove dispatch, not delivery. Prove delivery by hand.

```bash
composer dev
```

In a second terminal:

```bash
php artisan tinker
```

```php
$ticket = App\Models\Ticket::first() ?? App\Models\Ticket::factory()->create();
App\Models\Message::factory()->for($ticket)->create(['body' => 'over the wire']);
```

In the `composer dev` output, the Reverb process should log a message published to `private-ticket.{id}`. If it does not, check that `BROADCAST_CONNECTION=reverb` and that the Reverb process actually started.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "Broadcast MessageCreated over Reverb with policy-backed channels

Channel authorisation calls TicketPolicy rather than repeating the rule, so
the websocket and HTTP surfaces cannot drift apart. Broadcasting auth sits
at /api/broadcasting/auth behind auth:sanctum, which accepts a session
cookie from the web client and a bearer token from the native clients on
the same endpoint. Tests cover both credentials and the stranger case.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 8: Generate TypeScript from the data objects

**Files:**
- Create: `config/typescript-transformer.php` (published)
- Modify: `app/Data/{UserData,TicketData,MessageData}.php` (attribute)
- Create: `resources/js/types/generated.d.ts` (generated, committed)
- Modify: `composer.json` (script)
- Test: `tests/Feature/GeneratedTypesTest.php`

**Interfaces:**
- Consumes: the data objects from Task 5.
- Produces: `resources/js/types/generated.d.ts` exporting `App.Data.UserData`, `App.Data.TicketData`, `App.Data.MessageData`, `App.Enums.UserRole`, `App.Enums.TicketStatus`. Clients in 1B and 1C copy this file.

- [ ] **Step 1: Install and publish**

```bash
composer require spatie/typescript-transformer
php artisan vendor:publish --provider="Spatie\LaravelTypeScriptTransformer\TypeScriptTransformerServiceProvider"
```

- [ ] **Step 2: Configure it**

In `config/typescript-transformer.php`, set:

```php
'auto_discover_types' => [
    app_path('Data'),
    app_path('Enums'),
],

'output_file' => resource_path('js/types/generated.d.ts'),
```

- [ ] **Step 3: Mark the classes**

Add `#[TypeScript]` above each of `UserData`, `TicketData`, `MessageData`, `UserRole` and `TicketStatus`, importing `Spatie\TypeScriptTransformer\Attributes\TypeScript`.

Example, on `app/Enums/UserRole.php`:

```php
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

#[TypeScript]
enum UserRole: string
{
    case Customer = 'customer';
    case Agent = 'agent';
}
```

- [ ] **Step 4: Generate and read the output**

```bash
php artisan typescript:transform
cat resources/js/types/generated.d.ts
```

Expected: a declaration file containing `UserData`, `TicketData`, `MessageData`, and both enums. Read it. If `CarbonImmutable` came out as something unusable rather than `string`, add a transformer mapping for it in the config's `transformers` array and regenerate.

- [ ] **Step 5: Write the drift test**

Create `tests/Feature/GeneratedTypesTest.php`:

```php
<?php

use Illuminate\Support\Facades\Artisan;

it('has generated types that match the current data objects', function () {
    $path = resource_path('js/types/generated.d.ts');
    $before = file_get_contents($path);

    Artisan::call('typescript:transform');

    $after = file_get_contents($path);

    expect($after)->toBe($before, 'Generated TypeScript is stale. Run: php artisan typescript:transform');
});
```

This is the test that makes decision 0006 worth its dependency. Without it, a changed PHP response shape silently disagrees with three clients until something fails at runtime on a device.

- [ ] **Step 6: Run it and watch it pass**

```bash
php artisan test --filter=GeneratedTypesTest
```

Expected: PASS. Then prove it catches drift: add a field to `TicketData`, run the test, watch it fail, remove the field, watch it pass again. A test you have not seen fail is not evidence.

- [ ] **Step 7: Add a composer script**

In `composer.json`, under `scripts`:

```json
"types": "@php artisan typescript:transform"
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Generate TypeScript types from PHP data objects

Three TypeScript clients consume this API, so the response shape needs one
source of truth. The drift test fails if generated.d.ts is stale, which is
what makes this worth two dependencies rather than hand written interfaces
that silently disagree with the API. See decision 0006.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 9: Seed data and the Inertia web client

**Files:**
- Create: `database/seeders/RelaySeeder.php`
- Modify: `database/seeders/DatabaseSeeder.php`
- Create: `app/Http/Controllers/TicketWebController.php`
- Modify: `routes/web.php`
- Create: `resources/js/pages/tickets/index.tsx`, `resources/js/pages/tickets/show.tsx`
- Create: `resources/js/hooks/use-ticket-channel.ts`
- Test: `tests/Feature/TicketWebTest.php`

**Interfaces:**
- Consumes: everything from Tasks 2 through 8.
- Produces: `/tickets` and `/tickets/{ticket}` served through Inertia, subscribed to `private-ticket.{id}` and appending messages live. Seeded accounts `agent@relay.test` and `priya@relay.test`, both password `password`.

- [ ] **Step 1: Write the seeder**

`database/seeders/RelaySeeder.php`:

```php
<?php

namespace Database\Seeders;

use App\Enums\TicketStatus;
use App\Enums\UserRole;
use App\Models\Message;
use App\Models\Ticket;
use App\Models\User;
use Illuminate\Database\Seeder;

class RelaySeeder extends Seeder
{
    public function run(): void
    {
        $agent = User::factory()->create([
            'name' => 'Marcus Webb',
            'email' => 'agent@relay.test',
            'password' => bcrypt('password'),
            'role' => UserRole::Agent,
        ]);

        $customer = User::factory()->create([
            'name' => 'Priya Raman',
            'email' => 'priya@relay.test',
            'password' => bcrypt('password'),
            'role' => UserRole::Customer,
        ]);

        $ticket = Ticket::factory()->for($customer, 'customer')->create([
            'subject' => "Can't export invoices to CSV",
            'status' => TicketStatus::Open,
            'assigned_agent_id' => $agent->id,
        ]);

        $exchange = [
            [$customer, 'The CSV export button spins for a while and then nothing downloads. I have tried Chrome and Safari.'],
            [$agent, 'Thanks Priya. Which date range did you have selected when it failed? That narrows it down a lot.'],
            [$customer, 'Jan 1 to today. It worked fine last month.'],
        ];

        foreach ($exchange as [$author, $body]) {
            Message::factory()->for($ticket)->for($author, 'author')->create(['body' => $body]);
        }

        Ticket::factory()->count(4)->create(['assigned_agent_id' => $agent->id]);
    }
}
```

Call it from `DatabaseSeeder::run()`:

```php
$this->call(RelaySeeder::class);
```

```bash
php artisan migrate:fresh --seed
```

- [ ] **Step 2: Write the failing test**

Create `tests/Feature/TicketWebTest.php`:

```php
<?php

use App\Enums\UserRole;
use App\Models\Ticket;
use App\Models\User;
use Inertia\Testing\AssertableInertia;

it('renders a customers own tickets', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    Ticket::factory()->count(2)->for($customer, 'customer')->create();
    Ticket::factory()->count(3)->create();

    $this->actingAs($customer)
        ->get('/tickets')
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('tickets/index')
            ->has('tickets.data', 2));
});

it('renders a ticket thread', function () {
    $customer = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->for($customer, 'customer')->create();

    $this->actingAs($customer)
        ->get("/tickets/{$ticket->id}")
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('tickets/show')
            ->where('ticket.id', $ticket->id));
});

it('refuses a stranger opening a ticket over the web', function () {
    $stranger = User::factory()->create(['role' => UserRole::Customer]);
    $ticket = Ticket::factory()->create();

    $this->actingAs($stranger)->get("/tickets/{$ticket->id}")->assertForbidden();
});
```

The third test is the IDOR check on the web transport. The API has its own in Task 5. Both matter, because they are different routes.

- [ ] **Step 3: Run it and watch it fail**

```bash
php artisan test --filter=TicketWebTest
```

Expected: FAIL, 404.

- [ ] **Step 4: Write the web controller**

`app/Http/Controllers/TicketWebController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Data\MessageData;
use App\Data\TicketData;
use App\Enums\UserRole;
use App\Models\Ticket;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class TicketWebController extends Controller
{
    public function index(Request $request): Response
    {
        $tickets = Ticket::query()
            ->with(['customer', 'assignedAgent'])
            ->when(
                $request->user()->role === UserRole::Customer,
                fn ($query) => $query->where('customer_id', $request->user()->id),
            )
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->paginate(20);

        return Inertia::render('tickets/index', [
            'tickets' => TicketData::collect($tickets),
        ]);
    }

    public function show(Request $request, Ticket $ticket): Response
    {
        $this->authorize('view', $ticket);

        $ticket->load(['customer', 'assignedAgent']);

        return Inertia::render('tickets/show', [
            'ticket' => TicketData::fromModel($ticket),
            'messages' => MessageData::collect(
                $ticket->messages()->with('author')->orderBy('id')->get()
            ),
        ]);
    }
}
```

Same query and same policy call as the API controller. The data objects are shared, so the web page and the JSON API cannot describe a ticket differently.

- [ ] **Step 5: Register the routes**

In `routes/web.php`, inside the existing authenticated group:

```php
Route::get('/tickets', [TicketWebController::class, 'index'])->name('tickets.index');
Route::get('/tickets/{ticket}', [TicketWebController::class, 'show'])->name('tickets.show');
```

- [ ] **Step 6: Find out how Echo was actually wired**

`install:broadcasting` sets up the client side, and what it installs depends on the starter kit. Look before writing against it:

```bash
cat resources/js/echo.* 2>/dev/null
grep -E "echo|pusher" package.json
```

Note whether the project has `@laravel/echo-react` with a `configureEcho` helper, or plain `laravel-echo` with a `window.Echo` instance. Write step 7 against whichever is present. Do not install the other one.

- [ ] **Step 7: Write the channel hook**

`resources/js/hooks/use-ticket-channel.ts`, for the plain `laravel-echo` case:

```ts
import { useEffect } from 'react';
import type { App } from '@/types/generated';

type MessageCreated = App.Data.MessageData;

export function useTicketChannel(
    ticketId: number,
    onMessage: (message: MessageCreated) => void,
) {
    useEffect(() => {
        const channel = window.Echo.private(`ticket.${ticketId}`);
        channel.listen('.message.created', onMessage);

        return () => {
            channel.stopListening('.message.created', onMessage);
            window.Echo.leave(`ticket.${ticketId}`);
        };
    }, [ticketId, onMessage]);
}
```

The leading dot on `.message.created` is not a typo. It tells Echo the event name is a literal broadcast name from `broadcastAs()` rather than a fully qualified PHP class name. Omitting it is the single most common reason a Laravel broadcast appears to do nothing.

The cleanup function matters. Without `leave`, navigating between tickets accumulates subscriptions and the same message renders several times.

If step 6 found `@laravel/echo-react`, use its `configureEcho` and its hook instead, keeping the same file path and the same exported function signature so the rest of this task is unchanged.

- [ ] **Step 8: Write the thread page**

`resources/js/pages/tickets/show.tsx`:

```tsx
import { useCallback, useState } from 'react';
import { useTicketChannel } from '@/hooks/use-ticket-channel';
import type { App } from '@/types/generated';

type Props = {
    ticket: App.Data.TicketData;
    messages: App.Data.MessageData[];
};

export default function Show({ ticket, messages: initial }: Props) {
    const [messages, setMessages] = useState(initial);

    const append = useCallback((incoming: App.Data.MessageData) => {
        setMessages((current) =>
            current.some((m) => m.id === incoming.id) ? current : [...current, incoming],
        );
    }, []);

    useTicketChannel(ticket.id, append);

    return (
        <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
            <header className="flex items-baseline gap-3">
                <h1 className="text-lg font-semibold">{ticket.subject}</h1>
                <span className="font-mono text-xs text-muted-foreground">TKT-{ticket.id}</span>
            </header>

            <ol className="flex flex-col gap-3">
                {messages.map((message) => (
                    <li key={message.id} className="rounded-lg border p-3">
                        <p className="text-sm">{message.body}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                            {message.author.name}
                        </p>
                    </li>
                ))}
            </ol>
        </div>
    );
}
```

The `some((m) => m.id === incoming.id)` guard is deliberate. The sender receives their own broadcast, and without it their message renders twice. There is a server-side alternative using `toOthers()`, which needs the socket id threaded through the request. The client-side guard is correct regardless of how the message arrived, so it stays even when `toOthers()` is added later.

There is no composer on this page yet. Posting from the web client arrives with slice 2. Slice 1 proves messages arrive, and Task 10 posts them over the API.

- [ ] **Step 9: Write the list page**

`resources/js/pages/tickets/index.tsx`:

```tsx
import { Link } from '@inertiajs/react';
import type { App } from '@/types/generated';

type Props = {
    tickets: { data: App.Data.TicketData[] };
};

export default function Index({ tickets }: Props) {
    if (tickets.data.length === 0) {
        return (
            <div className="mx-auto max-w-2xl p-6">
                <p className="text-sm text-muted-foreground">
                    Nothing open. Start a ticket and we will reply within the hour.
                </p>
            </div>
        );
    }

    return (
        <div className="mx-auto flex max-w-2xl flex-col gap-2 p-6">
            <h1 className="text-lg font-semibold">My tickets</h1>
            <ul className="divide-y rounded-lg border">
                {tickets.data.map((ticket) => (
                    <li key={ticket.id}>
                        <Link
                            href={`/tickets/${ticket.id}`}
                            className="flex items-center gap-3 p-3 hover:bg-muted"
                        >
                            <span className="font-mono text-xs uppercase">{ticket.status}</span>
                            <span className="text-sm font-medium">{ticket.subject}</span>
                            <span className="ml-auto font-mono text-xs text-muted-foreground">
                                TKT-{ticket.id}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
```

The empty state is written now rather than later. It is one of the five states every screen owes, and it is the one users reach most often at the start.

- [ ] **Step 10: Run the tests and the type checker**

```bash
php artisan test --filter=TicketWebTest
npm run build
```

Expected: tests PASS, build succeeds with no TypeScript errors. If `@/types/generated` does not resolve, check the path alias in `tsconfig.json` and that `resources/js/types/generated.d.ts` exists from Task 8.

- [ ] **Step 11: Watch two browsers hold one conversation**

This is the moment the slice exists for.

```bash
composer dev
```

1. Open `http://localhost:8000/tickets` in a normal window, sign in as `priya@relay.test` / `password`, open the CSV export ticket.
2. Open a private window, sign in as `agent@relay.test` / `password`, open the same ticket.
3. In a terminal, post a message as the agent over the API using the curl block from Task 5 step 11, pointed at `POST /api/tickets/{id}/messages`.
4. Both browser windows should append the message with no refresh.

If nothing appears: check the Reverb process is running, check the browser console for a failed `POST /api/broadcasting/auth`, and check that the event name in `listen()` starts with a dot.

Look at the screen properly while you are here. Spacing, alignment, whether the timestamp column lines up. Fix what looks wrong now.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "Add Inertia ticket list and live thread

The thread subscribes to private-ticket.{id} and appends on message.created.
Incoming messages are deduplicated by id on the client because the sender
receives their own broadcast, and the guard stays correct regardless of
whether toOthers() is added server side later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 10: End-to-end proof with Playwright

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/live-message.spec.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the running application.
- Produces: `npm run test:e2e`, one spec proving a message crosses between two authenticated browser contexts.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

Add to `.gitignore`:

```
/test-results
/playwright-report
```

- [ ] **Step 2: Configure it**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: 'http://localhost:8000',
        trace: 'retain-on-failure',
    },
});
```

No `webServer` block. `composer dev` runs four processes and Playwright can only manage one, so the suite assumes the stack is already up. That is stated in the failure message in step 3 rather than left to be discovered.

- [ ] **Step 3: Write the failing spec**

`tests/e2e/live-message.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).not.toHaveURL(/login/);
}

test('a message posted by the agent reaches the customer with no refresh', async ({ browser }) => {
    const customerContext = await browser.newContext();
    const agentContext = await browser.newContext();

    const customer = await customerContext.newPage();
    const agent = await agentContext.newPage();

    await signIn(customer, 'priya@relay.test');
    await signIn(agent, 'agent@relay.test');

    await customer.goto('/tickets');
    await customer.getByText("Can't export invoices to CSV").click();
    await expect(customer.getByRole('heading', { name: /export invoices/i })).toBeVisible();

    const ticketId = customer.url().split('/').pop();
    expect(ticketId).toBeTruthy();

    await agent.goto(`/tickets/${ticketId}`);

    const body = `Checked the logs, found it. ${Date.now()}`;

    // Post as the agent through the API, using the agent's session cookie.
    const response = await agent.request.post(`/api/tickets/${ticketId}/messages`, {
        data: { body, idempotency_key: crypto.randomUUID() },
        headers: { Accept: 'application/json' },
    });
    expect(response.status()).toBe(201);

    // The customer's page never reloaded.
    await expect(customer.getByText(body)).toBeVisible();
    await expect(agent.getByText(body)).toBeVisible();
});
```

Two browser contexts, not two pages, so the sessions are genuinely separate. The assertion is that the customer's page shows text it never fetched, which is only possible over the websocket.

The selectors in `signIn` come from the starter kit's login form. Open `/login` and read the actual labels before running this; adjust the two `getByLabel` calls to match what is there.

- [ ] **Step 4: Run it and watch it fail**

Start the stack in one terminal:

```bash
php artisan migrate:fresh --seed
composer dev
```

In another:

```bash
npx playwright test
```

Expected: FAIL at first, on a selector or on the message not arriving. Read the trace with `npx playwright show-trace`, fix, and re-run until green. If the failure is `connect ECONNREFUSED`, `composer dev` is not running.

- [ ] **Step 5: Add the script**

In `package.json`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 6: Run the whole suite**

```bash
php artisan test
npm run test:e2e
npm run build
```

Expected: all three green. Paste the real output into the handoff. A summary is not evidence.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add end to end proof that a message crosses two browser sessions

Two browser contexts so the sessions are genuinely separate. The customer
page asserts on text it never fetched, which is only possible over the
websocket, so the test fails if Reverb, channel authorisation or the client
subscription break.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

---

### Task 11: Repo conventions and the run skill

**Files:**
- Create: `backend-laravel/CLAUDE.md`
- Create: `backend-laravel/.claude/skills/run-app/SKILL.md`

**Interfaces:**
- Consumes: the working application.
- Produces: a repo-level `run-app` skill that the built-in `run` skill finds, so starting this app never needs rediscovering.

- [ ] **Step 1: Write the run skill**

`backend-laravel/.claude/skills/run-app/SKILL.md`:

```markdown
---
name: run-app
description: Start the Relay Laravel backend with Postgres, queue worker, Reverb and Vite. Use whenever this app needs running, serving, restarting, or when realtime is not working locally.
---

# Running the Relay backend

Docker must be up first. The daemon is not started automatically.

```bash
docker compose up -d
until [ "$(docker inspect -f '{{.State.Health.Status}}' relay-postgres)" = "healthy" ]; do sleep 1; done
composer dev
```

`composer dev` runs four processes: `serve`, `queue:work`, `reverb:start`, `vite`.
The app is at http://localhost:8000.

Seeded accounts, both password `password`:

- `agent@relay.test`, an agent
- `priya@relay.test`, a customer

Reset the database: `php artisan migrate:fresh --seed`.

## When realtime is not working

Check these in order before reading any code.

1. Is the Reverb process actually running. It is one of the four in `composer dev`.
2. Is `BROADCAST_CONNECTION=reverb` in `.env`.
3. Does the browser console show a failed `POST /api/broadcasting/auth`. That is channel authorisation, and `TicketPolicy` decides it.
4. Does the client `listen()` call start with a dot: `.message.created`, not `message.created`. Without the dot Echo expects a fully qualified PHP class name and silently matches nothing.

Almost every local realtime failure is one of these four, not a defect.

## Tests

```bash
php artisan test        # Pest, runs against the relay_test Postgres database
npm run test:e2e        # Playwright, needs composer dev already running
```
```

- [ ] **Step 2: Write the repo CLAUDE.md**

`backend-laravel/CLAUDE.md`:

```markdown
# Relay backend

Laravel 13 API, web client and websocket server for Relay. Design and decision records live in
the parent repo at `raufkhandevs/relay`, under `docs/`.

## Conventions specific to this repo

- API response shapes are `spatie/laravel-data` objects in `app/Data`, never raw arrays or
  Eloquent resources. They generate `resources/js/types/generated.d.ts`, which three clients
  consume. Run `composer types` after changing one, or `GeneratedTypesTest` fails.
- `TicketPolicy` is the only place ticket authorisation is expressed. `routes/channels.php`
  calls it rather than repeating the rule. Never write the rule twice.
- `tickets.last_message_at` is written by `MessageObserver` and nothing else.
- Postgres, not SQLite, including under test. See decision 0004 in the parent repo.
- Message history uses `cursorPaginate`. Ticket lists use `paginate`.
- Writes that a client may retry require an idempotency key.

## Running it

See `.claude/skills/run-app`.

## Never

- Commit `.env`.
- Run `git push`. Rauf pushes, always. Commit locally and hand him the command.
- Hand edit `resources/js/types/generated.d.ts`.
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add repo conventions and a run-app skill

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01P53oHmjh9DrvgJZT9svxfU"
```

- [ ] **Step 4: Run the ship gate**

Invoke the `ship-gate` skill. Slice 1A touches authentication, authorisation and a public API contract, so `security-auditor` runs regardless of diff size.

- [ ] **Step 5: Hand Rauf the push commands**

```bash
cd /Users/apple/work/app-development/backend-laravel
git push

cd /Users/apple/work/app-development
git add backend-laravel
git commit -m "Bump backend-laravel to slice 1A"
git push
```

The parent's submodule pointer moves here, at the slice boundary, which is the convention from decision 0008.

---

## Done when

- `php artisan test` is green.
- `npm run test:e2e` is green.
- `npm run build` produces no TypeScript errors.
- Two browsers signed in as different users show the same new message with no refresh.
- A customer cannot read another customer's ticket over HTTP, over the web route, or over the websocket channel. Three separate tests.
- `backend-laravel` is pushed and the parent's submodule pointer is bumped.

## Not in 1A

Posting from the web UI (slice 2), attachments, push, presence, assignment, statuses beyond `open`.
The Electron console is plan 1B, the Expo client is plan 1C. Both are written after 1A lands, against the generated types rather than against a guess.
