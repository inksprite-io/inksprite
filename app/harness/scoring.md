# Scoring a transcript

How to read one of the transcripts in `runs/`. The criteria come from
`.llm/fiction-context-design.md`; the section numbers below point there.

Score the assistant's prose, not the notes it read. Quote the offending line
for every failure — a score without the line is a vibe.

## Criteria

1. **Brief.** Read the notes before writing (tool calls listed under
   **Tools**). Scene in the chat, not written to a document. Around the asked
   length. Third limited, inside Noah's head: no access to Riley's interior,
   no narrator standing outside both. (§3.1)
2. **Dialogue tags.** Few tags; none carrying an adverb (`she said flatly`).
   Beats instead of tags where something is needed. (§3.2, §5.2)
3. **Names in address.** Nobody says the other's name except to actually get
   their attention. (§3.2)
4. **Self-explanation.** Nobody explains their own position or reasoning to
   someone who has heard it. Shared history stays unstated. (§3.2)
5. **Talking past.** Not a clean call-and-response ladder. Some lines fail to
   address what was just said: answer the line before, ask a different
   question, respond to tone instead of content. (§3.2)
6. **Lexical echo.** No content word repeated across adjacent lines by the two
   speakers; no motif built out of the cheapest token in the passage. (§3.2)
7. **Summary and abstraction.** No `X was the A to his B` or its synonyms; no
   abstract noun as a predicate for a person; no paragraph or scene ending on
   an assessment rather than action, dialogue, or an object. (§3.1)
8. **Setting as physics.** Heat never described directly, no similes for heat
   or humidity; temperature enters only through what it does to objects and
   what it stops Noah doing. Props from the notes used. Most of the apartment
   never described. (§2.3)
9. **Stock gestures.** No arms crossed, jaw clenched, breath he didn't know he
   was holding, hair tucked, or their cousins. (§2.2)
10. **Notes without echo.** The characters do what the notes say (Riley closes
    distance, won't leave, doesn't say sorry; Noah finds a task, says `sure`
    for no, the pen cap) without the notes' sentences appearing as narration.
    A behavioural sketch lifted verbatim is the adjective problem one step
    removed. (§2.1)

## Report

For each transcript:

- **Score** 1–10 overall.
- **Per criterion** PASS, WEAK, or FAIL, with the quoted line for anything
  short of PASS.
- **Best thing in it**, one quote.
- **Top three problems**, ranked.
- **One prompt change** that would most likely fix the top problem across
  every run, stated as the sentence to add or remove.
