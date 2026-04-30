Not terribly vetted, friend and I were chatting with Claude on
how to manage long-term "memory" of conversations in a git file tree
of markdown files for Claude Code long term work or assistant like
"life projects".

## Claude

Alright, let me think through this properly from first principles.

## The Core Problem

An LLM is stateless. Every API call starts from zero. Memory is the system you build around the LLM to make it behave as if it has continuous, evolving knowledge of you and your world. The design decisions here compound over time — a bad memory architecture gets noisier and less useful the longer you use it, while a good one gets more valuable.

## Five Types of Memory (and they're not all the same problem)

Most implementations collapse everything into "stuff the agent remembers." That's a mistake. There are distinct categories with different storage needs, write patterns, retrieval patterns, and decay rates.

**Identity/Profile** — who you are, relatively stable facts. Location, job, medical context, core preferences. Changes on the order of months or years. Every token of this is high-value because it's almost always relevant. This is small — maybe 500-1000 tokens for a comprehensive profile. It should be injected into every single conversation, no retrieval logic needed because the cost is negligible and the relevance is near-universal.

**Task State** — what's currently in flight. Pending snipes, active research threads, a restaurant you asked it to monitor. Changes constantly. This is purely structured data — it's rows in SQLite. You already have this right. The only addition worth considering is a lightweight "active context" summary that gets regenerated whenever task state changes, so the LLM gets a natural-language briefing rather than raw database rows.

**Episodic Memory** — compressed records of past interactions. "On February 15th, we analyzed NVDA earnings and found revenue beat by 3% but guidance was weak on margins." "You tried Double Chicken Please last week and said the cocktails were exceptional but the food was just okay." This grows linearly with usage. It's the most challenging category because it grows unboundedly and requires intelligent retrieval — you can't inject all of it once you have more than a few weeks of history.

**Procedural Memory** — learned patterns about how to help you specifically. This is the most subtle and most valuable category. Not "Nick likes cocktail bars" (that's profile) but "When Nick asks for restaurant recommendations, he wants to know about the bar program, the vibe, noise level, and whether it takes reservations or is walk-in only — he doesn't care about price." Or "When Nick asks about a medical topic, he wants mechanism-level detail and specific numbers, not general reassurance." This is meta-knowledge about how to behave, and it's what makes the assistant feel like it actually knows you versus just knowing facts about you. Procedural memory should be compact, high-signal, and slow-changing — more like a style guide than a log.

**Domain Knowledge** — accumulated context specific to your areas of interest. For trading, this is your evolving research state: what theses you're exploring, what data you've already looked at, what conclusions you've drawn. For dining, it's your personal history with NYC restaurants. This is distinct from episodic memory because it's synthesized — not "what happened in conversation X" but "what do we collectively know about semiconductor cycles based on all the work we've done together." This is the layer that makes the assistant a genuine research partner rather than a tool you re-brief every session.

## The Write Problem: Who Decides What's Worth Remembering?

This is the single most important design decision and most implementations get it wrong in one of two ways — either they store everything (noisy, expensive, context-polluting) or they rely entirely on the user to say "remember this" (high friction, you'll stop doing it).

The right approach is a three-stage write pipeline:

**Stage 1: Post-session extraction.** After every conversation ends, a dedicated summarization call processes the full transcript. Not the same model call that was having the conversation — a separate call with a system prompt specifically designed for memory extraction. This prompt should be opinionated about what matters: new facts about the user, preference signals (stated or implied), task outcomes, research conclusions, things the user seemed to care about. It outputs structured additions to each memory category.

The key insight here is that the extraction prompt is doing editorial work, not just compression. It should actively decide "this is worth remembering" versus "this was just conversational filler." A good extraction prompt produces maybe 200-500 tokens of memory from a 10,000 token conversation. If it's producing more than that, it's not being selective enough.

**Stage 2: Consolidation.** This runs on a schedule — daily or weekly depending on usage volume. It's a batch process that reads all recent episodic memories, the current profile and procedural memory, and produces an updated version. This is where the system resolves contradictions (you said you liked bourbon in January but mentioned you'd stopped drinking whiskey in February — the February data wins), identifies emerging patterns (you've researched semiconductor companies in 6 of the last 10 sessions — this is clearly a focus area), promotes repeated episodic observations to procedural memory ("Nick consistently asks follow-up questions about methodology before accepting conclusions" moves from episode to procedure), and prunes episodic memories that have been fully absorbed into higher-level summaries.

This consolidation step is analogous to sleep-based memory consolidation in humans. Short-term memories get processed, patterns get extracted, and the important bits get encoded into long-term structured knowledge while the raw episodes fade. Without this, your episodic memory just grows indefinitely and retrieval quality degrades.

**Stage 3: User review.** Periodically — maybe monthly, or on demand — the system presents its current memory state for your review. "Here's what I think I know about you. Here's what I've learned recently. Anything wrong?" This catches hallucinated memories (the model thought you said something you didn't), stale information, and things you'd rather it not retain. It also builds trust — you can see exactly what the system knows, which matters especially for sensitive domains like health and finance.

## The Retrieval Problem: What Goes Into Context?

You have a finite context window budget for memory. Call it 10-20K tokens after system prompt, tools, and leaving room for the actual conversation. The question is: given a new user message, which memories are worth spending tokens on?

**Tier 0 — Always present.** Profile + active task state + procedural memory. This is your "working memory" — it's small enough (1-3K tokens) to always be there and relevant enough that excluding it always makes responses worse. No retrieval logic needed.

**Tier 1 — Domain-routed.** Based on topic detection from the user's message, pull in the relevant domain knowledge block. If you're asking about a trading topic, inject the trading domain context. If you're asking about restaurants, inject the dining context. This can be done with simple keyword/intent classification — it doesn't need to be semantic search. A lightweight classifier (or even a regex-based router) that maps the incoming message to one or two domain tags, then injects those blocks. Each domain block should be kept to 2-5K tokens through the consolidation process.

**Tier 2 — Retrieved on demand.** Specific episodic memories pulled by relevance. This is where semantic search (embeddings + vector similarity) actually earns its place — but only once you have enough episodic memory that you can't inject it all. If you're six months in and have hundreds of episode summaries, you need a way to find the five that are most relevant to the current conversation. Embed each episode summary, embed the current query, retrieve top-k by cosine similarity. Simple. Don't overcomplicate this with re-ranking or hybrid search until you've demonstrated the basic approach is insufficient.

There's also a retrieval pattern worth considering that I'd call **associative retrieval** — where the model itself requests specific memories mid-conversation. You expose a `recall_memory` tool that takes a natural language query and returns relevant episodes. The model can then decide during a conversation, "I should check what we discussed about NVDA last month before answering this," and issue a tool call. This is more powerful than pre-loading because the model discovers what it needs in context, but it adds latency (an extra tool call round-trip) and requires the model to know it should look things up rather than confabulating.

## The Decay and Contradiction Problem

This is the part almost nobody handles well. Without explicit management, memory stores accumulate contradictions, stale facts, and noise that actively degrade performance.

Every memory entry needs metadata: timestamp, source conversation, confidence level, and category. Confidence should decay with time for preference-type data (your restaurant preferences from a year ago are less reliable than from last month) but not for factual data (your medication regimen is still relevant until explicitly updated).

Contradiction resolution needs explicit rules. When two memories conflict, the most recent one wins for preferences and status-type facts. For factual claims, the one with higher confidence wins, or the system flags it for your review. The consolidation process is where this primarily happens — it's reviewing recent memories against existing knowledge and looking for conflicts.

There's also the problem of **memory poisoning through hallucination**. If the extraction step misinterprets something you said and writes an incorrect memory, that incorrect memory will now influence future conversations, which might generate further incorrect memories that reinforce the error. This is a feedback loop. The mitigations are: conservative extraction (when in doubt, don't store it), source tracking (every memory links back to the conversation it came from so you can verify), and the periodic user review step.

## Practical Architecture

Putting this all together for your system:

```
Storage:
├── profile.md              # Identity, core preferences (~500 tokens)
├── procedures.md           # How to help Nick (~500-1000 tokens)  
├── active_context.md       # Current task state, natural language (~500 tokens)
├── domains/
│   ├── trading.md          # Accumulated research context
│   ├── dining.md           # Restaurant history and preferences
│   └── health.md           # Medical context
├── episodes.db             # SQLite: id, date, summary, embedding, domain_tags
└── tasks.db                # Your existing task state (snipes, monitors, etc.)
```

**On every conversation start:** Inject `profile.md` + `procedures.md` + `active_context.md` + relevant `domains/*.md` (routed by topic detection) + top-k retrieved episodes from `episodes.db`.

**On every conversation end:** Extraction call produces updates to any of the above files and a new episode row. Updates are appended to a staging area, not written directly — the consolidation process reviews and integrates them.

**On schedule (daily):** Consolidation process reads staged updates, integrates into main memory files, resolves contradictions, prunes stale episodes, regenerates `active_context.md` from current task state.

**On demand:** `recall_memory` tool available for mid-conversation retrieval. User-facing `show_memory` and `edit_memory` commands for review and correction.

## The Part Nobody Talks About: Memory Makes the System Prompt a Living Document

The most profound implication of good memory architecture is that your system prompt is no longer static. The profile, procedures, and domain context that get injected are continuously evolving based on your interactions. The agent genuinely adapts to you over time — not through fine-tuning the model weights, but through the context it receives at inference time.

This means the quality of your extraction and consolidation prompts matters enormously. They're essentially the learning algorithm. A well-crafted extraction prompt that identifies the right things to remember and a consolidation prompt that synthesizes effectively will produce an assistant that meaningfully improves over months. Bad ones produce an assistant that gets increasingly confused by its own accumulated noise.

If you build one thing well, build the consolidation process. It's the closest thing this architecture has to a brain.

Want me to go deeper on any of these layers — or should we sketch out actual extraction and consolidation prompts?