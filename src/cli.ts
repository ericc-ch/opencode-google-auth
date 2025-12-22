import yargs from "yargs"
import { hideBin } from "yargs/helpers"

await yargs(hideBin(process.argv))
  .scriptName("pkg-placeholder")
  .usage("$0 <cmd> [args]")
  .help()
  .parse()
