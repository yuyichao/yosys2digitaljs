#!/usr/bin/env node
"use strict";

const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2));

function read_files(l) {
    const ret = {};
    for (const name of l) {
        ret[name] = fs.readFileSync(name);
    };
    return ret;
}

const header = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html;charset=UTF-8" />
    <script type="text/javascript" src="main.js"></script>
    <title></title>
  </head>
  <body>`;

if (argv._.length === 0) {
    console.error('No Verilog files passed!');
    process.exit(1);
}
const yosys2digitaljs = require('./index.js');
const result = argv.tmpdir ? yosys2digitaljs.process_files(read_files(argv._)) : yosys2digitaljs.process(argv._);
result.then(res => {
    if (argv.html) {
        console.log(header);
        console.log('<div id="paper"></div><script>const circuit = new digitaljs.Circuit(');
    };
    if (argv.yosys_out) {
        console.log('/*');
        console.log(res.yosys_stdout);
        console.log('*/');
    }
    console.log(JSON.stringify(res.output, null, 2));
    if (argv.html) {
        console.log(');const paper = circuit.displayOn($(\'#paper\'));circuit.start();</script></body></html>');
    };
})
.catch(res => {
    console.error('Yosys failed!');
    console.error(res.stderr);
    process.exit(1);
});

