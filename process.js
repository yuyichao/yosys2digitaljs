#!/usr/bin/node
"use strict";

const assert = require('assert');
const topsort = require('topsort');
const fs = require('fs');
const dagre = require('dagre');

const header = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html;charset=UTF-8" />
    <script type="text/javascript" src="simcir.js"></script>
    <link rel="stylesheet" type="text/css" href="simcir.css" />
    <script type="text/javascript" src="simcir-basicset.js"></script>
    <link rel="stylesheet" type="text/css" href="simcir-basicset.css" />
    <script type="text/javascript" src="simcir-library.js"></script>
    <title></title>
  </head>
  <body>`;

function module_deps(data) {
    const out = [];
    for (const name in data.modules) {
        const mod = data.modules[name];
        for (const cname in mod.cells) {
            const cell = mod.cells[cname];
            if (cell.type in data.modules)
                out.push([cell.type, name]);
        }
    }
    return out;
}

function order_ports(data) {
    const binmap = {A: 'in0', B: 'in1', Y: 'out0'};
    const out = {};
    ['$and', '$or', '$xor'].forEach((nm) => out[nm] = binmap);
    for (const name in data.modules) {
        const mod = data.modules[name];
        const portmap = {};
        const ins = [], outs = [];
        for (const pname in mod.ports) {
            const port = mod.ports[pname];
            const pdata = {name: pname, num: port.bits[0]};
            switch (port.direction) {
                case 'input': ins.push(pdata); break;
                case 'output': outs.push(pdata); break;
                default: throw Error("Invalid port direction: " + port.direction);
            }
        }
        function comp(a, b) {
            return a.num - b.num;
        }
        ins.sort(comp);
        outs.sort(comp);
        for (const k in ins) portmap[ins[k].name] = "in" + k;
        for (const k in outs) portmap[outs[k].name] = "out" + k;
        out[name] = portmap;
    }
    return out;
}

function yosys_to_simcir(data, portmaps) {
    const out = {};
    for (const name in data.modules) {
        let n = 0;
        function gen_name() {
            return 'dev' + n++;
        }
        const nets = {};
        function get_net(k) {
            if (!(k in nets))
                nets[k] = {source: undefined, targets: []};
            return nets[k];
        }
        function add_net_source(k, d, p) {
            let net = get_net(k);
            assert(net.source === undefined);
            net.source = d+'.'+p;
        }
        function add_net_target(k, d, p) {
            let net = get_net(k);
            net.targets.push(d+'.'+p);
        }
        const mod = data.modules[name];
        const mout = {
            width: 800,
            height: 500,
            devices: [],
            connectors: []
        }
        out[name] = mout;
        for (const pname in mod.ports) {
            const port = mod.ports[pname];
            const dname = gen_name();
            let dev = {
                id: dname,
                x: 0,
                y: 0,
                label: pname,
                order: n
            };
            assert(port.bits.length == 1);
            switch (port.direction) {
                case 'input':
                    dev.type = 'In';
                    add_net_source(port.bits[0], dname, 'out0');
                    break;
                case 'output':
                    dev.type = 'Out';
                    add_net_target(port.bits[0], dname, 'in0');
                    break;
                default: throw Error('Invalid port direction: ' + port.direction);
            }
            mout.devices.push(dev);
        }
        for (const cname in mod.cells) {
            const cell = mod.cells[cname];
            const portmap = portmaps[cell.type];
            const dname = gen_name();
            let dev = {
                id: dname,
                x: 0,
                y: 0,
                label: cname
            };
            switch (cell.type) {
                case '$and': dev.type = 'AND'; break;
                case '$or': dev.type = 'OR'; break;
                case '$xor': dev.type = 'XOR'; break;
                default:
                    dev.type = cell.type;
                    //throw Error('Invalid cell type: ' + cell.type);
            }
            switch (cell.type) {
                case '$and': case '$or': case '$xor':
                    assert(cell.connections.A.length == 1);
                    assert(cell.connections.B.length == 1);
                    assert(cell.connections.Y.length == 1);
                    assert(cell.port_directions.A == 'input');
                    assert(cell.port_directions.B == 'input');
                    assert(cell.port_directions.Y == 'output');
//                    add_net_target(cell.connections.A[0], dname, "in0");
//                    add_net_target(cell.connections.B[0], dname, "in1");
//                    add_net_source(cell.connections.Y[0], dname, "out0");
                    break;
                default:
                    //throw Error('Invalid cell type: ' + cell.type);
            }
            for (const pname in cell.port_directions) {
                const pdir = cell.port_directions[pname];
                const pconn = cell.connections[pname];
                switch (pdir) {
                    case 'input':
                        add_net_target(pconn[0], dname, portmap[pname]);
                        break;
                    case 'output':
                        add_net_source(pconn[0], dname, portmap[pname]);
                        break;
                    default:
                        throw Error('Invalid port direction: ' + pdir);
                }
            }
            mout.devices.push(dev);
        }
        for (const nnum in nets) {
            const net = nets[nnum];
            for (const target in net.targets)
                mout.connectors.push({from: net.targets[target], to: net.source});
        }
    }
    return out
}

function layout_circuit(circ) {
    const g = new dagre.graphlib.Graph();
    const devmap = {};
    let maxx = 0, maxy = 0;

    g.setGraph({rankdir: 'RL'});
    g.setDefaultEdgeLabel(function() { return {}; });

    for (const dev of circ.devices) {
        g.setNode(dev.id, {
            id: dev.id,
            width: 32,
            height: 32
        });
        devmap[dev.id] = dev;
    }

    for (const conn of circ.connectors) {
        g.setEdge(conn.from.split('.')[0], conn.to.split('.')[0]);
    }

    dagre.layout(g);

    for (const nname of g.nodes()) {
        const node = g.node(nname);
        devmap[node.id].x = node.x;
        devmap[node.id].y = node.y;
        maxx = Math.max(maxx, node.x);
        maxy = Math.max(maxy, node.y);
        //console.log(nname + ":" + JSON.stringify(node));
    }

    circ.width = maxx + 256;
    circ.height = maxy + 64;
}

function layout_circuits(circs) {
    for (const name in circs) {
        layout_circuit(circs[name]);
    }
}

let obj = JSON.parse(fs.readFileSync('output.json', 'utf8'));
let portmaps = order_ports(obj);
let out = yosys_to_simcir(obj, portmaps);
layout_circuits(out);
let toporder = topsort(module_deps(obj));
let toplevel = toporder.pop();
console.log(header);
console.log('<script>');
for (const x of toporder) {
    console.log('simcir.registerDevice("'+x+'", ');
    console.log(JSON.stringify(out[x], null, 2));
    console.log(');');
}
console.log('</script>');
console.log('<div class="simcir">');
console.log(JSON.stringify(out[toplevel], null, 2));
console.log('</div>');
console.log('</body></html>');

