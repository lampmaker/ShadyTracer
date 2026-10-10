// EVERY SCENE THE TESTS GO OVER: the examples File › Examples opens (scenes/index.js) and the scenes that were the
// examples before 0.51.0, kept as fixtures (test/fixtures/scenes/index.js). A test that checked "every bundled scene"
// checks both: a new example has to compile and hold to the rules as the old ones did, and the old ones still do.
// { name, url, path }: name as a test prints it, the file's URL, and its path on disk.
import { fileURLToPath } from 'node:url'
import { SCENE_FILES, urlOf } from '../scenes/index.js'
import { FIXTURE_SCENES, fixtureUrl } from './fixtures/scenes/index.js'

const entry = (name, url) => ({ name, url, path: fileURLToPath(url) })
export const EXAMPLE_SCENES = SCENE_FILES.map(f => entry(f, urlOf(f)))
export const FIXTURES = FIXTURE_SCENES.map(f => entry(`fixtures/${f}`, fixtureUrl(f)))
export const EVERY_SCENE = [...EXAMPLE_SCENES, ...FIXTURES]
/** A fixture scene's path by its file name: for a test written against one of them. */
export const fixturePath = file => fileURLToPath(fixtureUrl(file))
