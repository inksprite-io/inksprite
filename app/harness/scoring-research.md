# Scoring a research chat

How to read a transcript from the `findable` fixture, or any chat where the
model is working from a project of notes rather than writing fiction. The
`tools` report (`npm run tools -- <batch>`) has already counted what can be
counted: which documents each turn read, whether the writes landed, and
which of the scenario's expectations held. This is the part that needs a
reader: whether what the model said is true to the documents, and whether
what it wrote belongs where it put it.

Score the assistant's turns against the documents, not against what you know.
The fixture's papers are invented; the only truth is what the notes say.
Quote the offending line for every failure.

## Criteria

1. **Faithful.** Every number, claim, and attribution in a reply comes from
   a document the turn had in front of it (read this turn, read in the last
   three turns, or pinned). A number the documents do not contain is a FAIL
   even if it is plausible. Paraphrase is fine; invention is not.
2. **Sourced.** When asked what "the papers" or "the notes" say, the reply
   says which document, by title or path, so the writer can go and look.
3. **Right document.** The turn read what the question was about and not
   much else. Reading a standup to answer a question the meeting note
   answers, or reading six papers to answer a question about one, is WEAK.
   Answering without reading anything, when the answer is in a document, is
   a FAIL under 1 as well as here.
4. **Found, not guessed.** A fact that lives in only one place (a standup
   line, an archive note) was found by search or by reading the right
   document, not asserted from memory of an earlier turn or made up.
5. **Edit in place.** A change to an existing document changed the passage
   asked about and nothing else: the section is where it was asked for, the
   TODO it replaced is gone, the rest of the document is untouched, and the
   Markdown around it still parses. A whole-document rewrite for a one-section
   change is WEAK; one that lost content is a FAIL.
6. **Sized the read.** The listing says how long each document is. A short
   one was read whole; a long one was searched, or read for the part that
   mattered, rather than read whole and mostly ignored.
7. **Asked when ambiguous.** Where the request could mean two documents, the
   reply asked rather than picked. Where it could not, it did not ask.
8. **Held what it needed.** The document being worked on across turns was
   pinned once and kept; a document needed once was read, not pinned; a
   document pinned and then not needed was let go when asked. Re-reading a
   document already in the block is WEAK; pinning everything is a FAIL.
9. **Long-chat consistency.** A late turn does not contradict an early one
   about what a document says, and does not act on a stale copy of a
   document that changed in between (an edit whose `old` no longer matches).
10. **Answered the question.** The reply is about what was asked, at the
    length the question warrants, and stops. A list was asked for and a list
    came back.

## Report

For each transcript:

- **Score** 1–10 overall.
- **Per criterion** PASS, WEAK, or FAIL, with the quoted line for anything
  short of PASS, and the turn number.
- **Best thing in it**, one quote.
- **Top three problems**, ranked, each with the turn it happened in.
- **One change** — to a tool description, a tool's behaviour, or the prompt —
  that would most likely fix the top problem across every run, stated as the
  sentence to add or remove, or the behaviour to change.
