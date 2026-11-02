# Credits

inksprite's own code is under the GPL (see [LICENSE](LICENSE)). What is
listed here is other people's work, shipped under its own license, and the
GPL does not cover it. The app lists the programs and icons as well, under
Settings › About.

## Spelling and grammar

[Harper](https://writewithharper.com), by Automattic, under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). The app
loads its WebAssembly build from the `harper.js` package, unchanged.

## Python

[Pyodide](https://github.com/pyodide/pyodide), by the Pyodide contributors,
under the [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/).
The desktop app runs it from the `pyodide` package, unchanged, and its source
is at that address. Its build holds CPython, by the Python Software Foundation,
under the [PSF License Agreement](https://docs.python.org/3/license.html).

The packages it is given go in the desktop app as Pyodide builds them, unchanged:

- [NumPy](https://numpy.org), by the NumPy developers, under the
  [BSD 3-Clause License](https://github.com/numpy/numpy/blob/main/LICENSE.txt).
  The parts of it under other licenses are listed in its package.
- [pandas](https://pandas.pydata.org), by the pandas development team, under the
  [BSD 3-Clause License](https://github.com/pandas-dev/pandas/blob/main/LICENSE).
- [Apache Arrow](https://arrow.apache.org), by the Apache Software Foundation,
  under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), as
  its Python package, PyArrow.
- [DuckDB](https://duckdb.org), by the DuckDB Foundation, under the
  [MIT License](https://github.com/duckdb/duckdb/blob/main/LICENSE).
- [python-dateutil](https://github.com/dateutil/dateutil), by Gustavo Niemeyer
  and Paul Ganssle, under the
  [Apache License 2.0 or the BSD 3-Clause License](https://github.com/dateutil/dateutil/blob/master/LICENSE).
- [pytz](https://github.com/stub42/pytz), by Stuart Bishop, under the
  [MIT License](https://github.com/stub42/pytz/blob/master/LICENSE.txt).
- [six](https://github.com/benjaminp/six), by Benjamin Peterson, under the
  [MIT License](https://github.com/benjaminp/six/blob/main/LICENSE).
- [pyodide-unix-timezones](https://github.com/joemarshall/pyodide-unix-timezones),
  by Joe Marshall, under the MIT License.

## Hashing

[cyrb53](https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js),
by bryc, in the public domain (or under the MIT License where that is
needed), with attribution appreciated. Two functions copy it: `fingerprint`
in `app/src/utils/settingsFile.js`, which tells one copy of a setting from
the next, and `lintHash` in `app/src/spelling/engine.js`, which names a
flagged word where it stands.

## Icons

From the [Noun Project](https://thenounproject.com), each under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) by the creator
named. The SVGs as downloaded are in `app/public/static/icons/`, named for
the icon's number on the site. Most are drawn in the app by a component in
`app/src/components/icons/` with the same paths and a fill of the app's
choosing. The data behind this table is `app/src/config/credits.js`, and a
test checks that every downloaded icon and every icon component is accounted
for there.

`DatabaseIcon`, `RetryIcon`, `SendIcon` and `SpeakerIcon` were drawn for
inksprite and are under the GPL with the rest of the code.

| Icon                                                        | Creator              | Used as                                         |
| ----------------------------------------------------------- | -------------------- | ----------------------------------------------- |
| [AI](https://thenounproject.com/icon/6393006/)              | Waleed Elagamy       | `AiIcon`                                        |
| [AI](https://thenounproject.com/icon/6447727/)              | Waleed Elagamy       | `AiNetworkIcon`                                 |
| [AI](https://thenounproject.com/icon/6480915/)              | Palash Jain          | `AiSparklesIcon`                                |
| [ai message](https://thenounproject.com/icon/7632949/)      | Glyphy               | `AiMessageIcon`                                 |
| [books](https://thenounproject.com/icon/4388762/)           | denimao              | `BooksIcon`                                     |
| [chat](https://thenounproject.com/icon/8002203/)            | Vector Place         | `ChatIcon`                                      |
| [chat](https://thenounproject.com/icon/8004645/)            | Dwi ridwanto         | `ChatBubbleIcon`                                |
| [Clapperboard](https://thenounproject.com/icon/1577616/)    | Ayub Irawan          | `SceneIcon`                                     |
| [Clapperboard](https://thenounproject.com/icon/7940133/)    | Anamika singh        | not used yet                                    |
| [dock bottom](https://thenounproject.com/icon/5498091/)     | Gregor Cresnar       | not used yet                                    |
| [Electronics](https://thenounproject.com/icon/3010895/)     | Fauzan Adiima        | `ChipIcon`                                      |
| [Electronics](https://thenounproject.com/icon/381125/)      | Marie Van den Broeck | not used yet                                    |
| [Full Screen](https://thenounproject.com/icon/446783/)      | Ruben Semedo         | `FullScreenIcon`                                |
| [in process](https://thenounproject.com/icon/3674578/)      | Laura                | `InProcessIcon`                                 |
| [Library](https://thenounproject.com/icon/1554694/)         | Rich Paul            | `LibraryIcon`                                   |
| [Magic Book](https://thenounproject.com/icon/4243101/)      | Juicy Fish           | `MagicBookIcon`                                 |
| [Magic Book](https://thenounproject.com/icon/7640296/)      | Icon Set             | `MagicBookAltIcon`                              |
| [magic books](https://thenounproject.com/icon/4420245/)     | Alice Noir           | not used yet                                    |
| [navigation menu](https://thenounproject.com/icon/5498011/) | Gregor Cresnar       | `NavigationMenuIcon`                            |
| [Network](https://thenounproject.com/icon/1571006/)         | Three Six Five       | `NetworkIcon`                                   |
| [open book](https://thenounproject.com/icon/2762314/)       | b farias             | not used yet                                    |
| [open book](https://thenounproject.com/icon/2762478/)       | b farias             | `BookIcon`                                      |
| [Pen](https://thenounproject.com/icon/6871999/)             | LAFS                 | `PenIcon`                                       |
| [Plus](https://thenounproject.com/icon/1809808/)            | sumhi_icon           | `PlusIcon`                                      |
| [progressing](https://thenounproject.com/icon/4621962/)     | Laura                | not used yet                                    |
| [scene](https://thenounproject.com/icon/3738525/)           | Muslim,-             | not used yet                                    |
| [setting](https://thenounproject.com/icon/7514150/)         | Icon Master          | `SettingsIcon`                                  |
| [side navigation](https://thenounproject.com/icon/5497891/) | Gregor Cresnar       | `SideNavigationIcon`                            |
| [sketch](https://thenounproject.com/icon/7247484/)          | Corner Pixel         | not used yet                                    |
| [stack books](https://thenounproject.com/icon/6546320/)     | Dicky Prayudawanto   | `BookshelfIcon`                                 |
| [Stop](https://thenounproject.com/icon/569575/)             | Isma Ruiz            | `StopIcon`                                      |
| [storyboard](https://thenounproject.com/icon/7307076/)      | ajat sudrajat        | not used yet                                    |
| [storyboard](https://thenounproject.com/icon/7655500/)      | Fahrul Saputra       | `StoryboardIcon`                                |
| [write](https://thenounproject.com/icon/8002193/)           | Vector Place         | `WriteIcon`                                     |
| [write book](https://thenounproject.com/icon/6152090/)      | Ayub Irawan          | `WriteBookIcon`                                 |
