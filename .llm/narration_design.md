# Narration

A document read aloud by a speech server, in the project's voices, and a chat
message in one of them. The first
cut is Kokoro through Kokoro-FastAPI, spoken to in the OpenAI shape, one
document at a time.

## What it is

- **A sidebar tab** beside the outline and the chats. It works on the document
  in the editor: read all of it, a run of blocks, or one block again; hear it;
  download it as one WAV.
- **Voices** belong to the project: a name for the writer, what the server is
  asked for, and a colour. The voice string is passed through as written, so a
  Kokoro mix like `af_heart+af_nicole(2)` works, and so will a plain OpenAI
  name. Each voice has a speed. One voice is the default, and reads everything
  nobody else does.
- **Speakers** belong to the document: which blocks are spoken by which voice.
  Set from the tab, one block at a time, with everything else the default
  voice's.
- **Pronunciation hints** belong to the project: `Aelinor:AY-lin-or`, one to a
  line, applied to what the server is sent and nowhere else.
- **The connection** is app-wide: where the server is, a key if it wants one,
  and the model name. It lives in the application state with the theme, not in
  the AI providers: a speech server is not something a chat can be sent to,
  and listing it there would look like it was.

## The markup question

The obvious way to say who speaks is to write it into the prose — `@Riley`
above a line — and it is the wrong one. The manuscript is the writer's; the
model reads it, the word count counts it, and one day a file on disk will
hold it. A copy of the prose with markers in it is no better: the copy goes
stale the moment the chapter is edited, and then either the markers or the
edits have to be thrown away.

So nothing is written into the document, and there is no copy. The document
is split into blocks every time it is read, and the speakers are an overlay on
those blocks. An assignment remembers the block it was made on, as its text
and where it was, and is found again by the text, at the nearest place to
where it was. A block that has moved keeps its speaker. Two that read the same
keep theirs apart. One that has been rewritten finds nothing, and reads in the
default voice again, which is the honest outcome: nobody can say who speaks a
line that no longer exists. The overlay is rewritten from the blocks as they
stand whenever a speaker is set, so stale assignments do not pile up. See
`tts/script.js`.

Text the writer wants spoken differently from how it is written is the
hints' job, not a second copy's.

## Blocks

A block is a paragraph: every node that holds text, markdown taken off, code
and rules left out. It is the smallest thing that can have a speaker of its
own, and one request to the speech server. See `tts/script.js`.

Speech is not stood apart from the narration around it within a paragraph.
That was tried — `"Hello," he said. "How are you?"` as three blocks, so a
character could have the lines and the narrator the tag — and taken out again,
because it reads badly. A speech model gives a sentence its shape from the
whole of it; cut at the quotation marks, each piece is said as a sentence of
its own, ending where it was cut, with a pause in the middle of the line. No
choice of pause fixes that. A character's line is given a voice by giving them
the paragraph, tag and all. (The split, with the machinery that joined
same-voice neighbours back into one request, is in the history at `2c625dcb`.)

## Audio

The server is asked for WAV, one request per block, in order. Audio is kept
for the session by signature: the voice as the server is asked for it, the
speed, and the words after the hints. Whatever changes what would be said — an
edit, a new speaker, a voice remixed, a hint — leaves that block without audio
and every other with the audio it had; putting the words back brings it back.
See `tts/reading.js`. That one rule is what makes the rest cheap:

- **Narrate** reads what has no audio: everything the first time, only what
  changed after that, and when nothing lacks any, all of it again.
- **A selection** of blocks, or **one block**, is read on its own, again if it
  has been read. The way to try a voice on a page before the chapter.
- There is no "stale" state to explain. Each block shows whether it has been
  read, and the track is whatever there is audio for.

The clips are joined by hand — a header and the bytes, a short silence between
blocks — into one track, so the player seeks anywhere and the block list follows the playhead.
The track is handed to a `Blob` in parts rather than copied into one buffer,
since the clips are already in memory. It is joined again when a run ends and
when the document stops agreeing with it, after the document has rested a
moment. None of this needs an audio context, and it runs the same under test.
Nothing is kept past the session: regenerating is cheap, and a chapter's WAV
is tens of megabytes, held once as clips and once in the track's blob. MP3
would need an encoder in the browser or a merge on the server, and is the
obvious next step for whole-manuscript audio.

## Colour

A voice has a colour, given when it is made and changed in its editor. A block
somebody was given shows it in the list, and while the narration tab is
showing, behind the text in the editor — as decorations, so the document is no
more written into for this than for anything else. What the default voice
reads for want of a speaker is left plain, so the speakers stand out. The
colouring goes when the tab does, and can be switched off from the tab.

## Selecting blocks

A block's words select it. Shift selects a run from the last block clicked;
Cmd or Ctrl adds one block or takes it out, so every paragraph one character
speaks can be picked without the ones between. The selection is what Narrate
reads when there is one, and what a speaker picked on any selected block is
given to, in one write; the menu says how many blocks it is for. A pick on a
block outside the selection is for that block alone.

## Chats

A chat turn can be read aloud from its header: the whole turn, in one voice,
the project's hints applied. The voice is the chat's — one of the project's
voices, chosen in the chat's settings — and the project's default until one is
chosen. This is a lighter thing than a document's narration and shares only
the parts that are the same. Nothing is kept: a message is heard once, and asked for
again if it is wanted again. And there is no track. The turn goes to the
server a paragraph at a time, each asked for as soon as the last is back and
played as soon as it is there, so the reading starts when the first paragraph
arrives and the next is usually waiting when one ends. One thing is read at a
time, app-wide; starting another stops the one that was speaking. See
`composables/useSpeech.js`.

## Storage

- `Story.narration` — `{ voices, defaultVoiceId, hints }`, all optional. Absent
  means one default voice. (`narratorId` is what `defaultVoiceId` was called
  for its first few days; it is read when that is absent, and carried over on
  the next write.)
- `Document.speakers` — the assignments, by block. Absent means all the
  default voice's.
- `Chat.voiceId` — the voice the chat is read aloud in. Absent, or naming a
  voice since removed, means the project's default.
- Application state `narration` — `{ endpoint, apiKey, model }` — and
  `ui.highlightSpeakers`.

No table, no index, no schema version: these are fields on rows that exist,
and a backup carries them.

## Not yet

- Narrating a folder or the whole manuscript into one file.
- Persisting audio, and MP3.
- Other kinds of server. The client is the OpenAI shape; a server that speaks
  something else gets a `type` on the connection when there is one.
- Text-level overrides beyond hints, such as skipping headings.
- Following the playhead in the editor, not only in the list.
