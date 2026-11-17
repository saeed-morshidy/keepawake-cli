// Test driver: runs inside a throwaway headless gnome-shell (see run.sh).
// Steps come from $KA_TEST_STEPS (JSON). Clicks are real pointer events from
// a virtual input device, so they go through the same path as a mouse.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'keepawake@saeed-morshidy.github.io';
const OUT = GLib.getenv('KA_TEST_OUT');

const sleep = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

function out(line) {
    const f = Gio.File.new_for_path(`${OUT}/log.txt`);
    const s = f.append_to(Gio.FileCreateFlags.NONE, null);
    s.write_all(new TextEncoder().encode(`${line}\n`), null);
    s.close(null);
}

function textOf(a) {
    try {
        if (a instanceof St.Label)
            return a.text;
        if (a instanceof St.Button)
            return a.label;
    } catch {}
    return null;
}

function* walk(a) {
    yield a;
    for (const c of a.get_children())
        yield* walk(c);
}

function find(root, text) {
    for (const a of walk(root)) {
        if (a.mapped && textOf(a) === text)
            return a;
    }
    return null;
}

function findByName(root, name) {
    for (const a of walk(root)) {
        if (a.mapped && a.name === name)
            return a;
    }
    return null;
}

export default class KaTest extends Extension {
    enable() {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            this._run().catch(e => out(`FATAL ${e}\n${e.stack}`)).finally(() => out('DONE'));
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {}

    async _shot(name) {
        const [W] = global.display.get_size();
        const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        await new Promise((resolve, reject) => {
            shooter.screenshot_area(W - 460, 0, 460, 560, stream, (o, res) => {
                try {
                    o.screenshot_area_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
        stream.close(null);
        out(`shot ${name}`);
    }

    async _click(actor, button = Clutter.BUTTON_PRIMARY) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const t = () => GLib.get_monotonic_time();
        this._ptr.notify_absolute_motion(t(), x + w / 2, y + h / 2);
        await sleep(200);
        this._ptr.notify_button(t(), button, Clutter.ButtonState.PRESSED);
        await sleep(80);
        this._ptr.notify_button(t(), button, Clutter.ButtonState.RELEASED);
        await sleep(250);
    }

    _status() {
        const [, stdout] = GLib.spawn_command_line_sync('keepawake status --json');
        return new TextDecoder().decode(stdout).trim();
    }

    async _run() {
        const seat = Clutter.get_default_backend().get_default_seat();
        this._ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        Main.overview.hide();
        await sleep(1500);
        // Warm up the virtual pointer: its first events can get lost.
        this._ptr.notify_absolute_motion(GLib.get_monotonic_time(), 400, 400);
        await sleep(500);

        const ind = Main.panel.statusArea[UUID];
        if (!ind) {
            out('FAIL indicator not in panel');
            return;
        }
        ind.menu.connect('open-state-changed', (_m, open) => out(`  (menu ${open ? 'opened' : 'closed'})`));
        const steps = JSON.parse(GLib.getenv('KA_TEST_STEPS') || '[]');
        for (const [op, arg, arg2] of steps) {
            try {
                if (op === 'wait') {
                    await sleep(arg);
                } else if (op === 'shot') {
                    await this._shot(arg);
                } else if (op === 'expect') {
                    // ["expect", {"running": true, "deadline-set": true, ...}]
                    const st = JSON.parse(this._status());
                    for (const [k, v] of Object.entries(arg)) {
                        const got = k === 'deadline-set' ? st.deadline !== null : st[k];
                        out(`${got === v ? 'PASS' : 'FAIL'} ${arg2 ?? ''} ${k}=${JSON.stringify(got)} (want ${JSON.stringify(v)})`);
                    }
                } else if (op === 'expect-panel') {
                    const texts = [...walk(ind)].filter(a => a.mapped).map(textOf).filter(t => t);
                    const ok = new RegExp(arg).test(texts.join(' '));
                    out(`${ok ? 'PASS' : 'FAIL'} ${arg2 ?? ''} panel ${JSON.stringify(texts)} ~ /${arg}/`);
                } else if (op === 'status') {
                    out(`status ${arg ?? ''} ${this._status()}`);
                } else if (op === 'panel') {
                    await this._click(ind, arg === 'middle' ? Clutter.BUTTON_MIDDLE : Clutter.BUTTON_PRIMARY);
                    out(`panel-click menu-open=${ind.menu.isOpen}`);
                } else if (op === 'click' || op === 'clickname') {
                    const a = op === 'click' ? find(ind.menu.actor, arg) : findByName(ind.menu.actor, arg);
                    if (!a) {
                        out(`FAIL no visible "${arg}" in menu`);
                        continue;
                    }
                    await this._click(a);
                    out(`clicked "${arg}" menu-open=${ind.menu.isOpen}`);
                } else if (op === 'cmd') {
                    GLib.spawn_command_line_sync(arg);
                    out(`cmd ${arg}`);
                } else if (op === 'label') {
                    const texts = [...walk(ind)].map(textOf).filter(t => t);
                    out(`panel-text ${JSON.stringify(texts)}`);
                } else if (op === 'layout') {
                    for (const a of walk(ind.menu.actor)) {
                        if (!a.mapped || !(a instanceof St.Label || a instanceof St.Button || a instanceof St.Icon))
                            continue;
                        if (a instanceof St.Label && a.get_parent() instanceof St.Button)
                            continue;
                        const [x, y] = a.get_transformed_position();
                        const [w, h] = a.get_transformed_size();
                        let font = '';
                        try {
                            font = a.get_theme_node().get_font().to_string();
                        } catch {}
                        out(`  ${a.constructor.name.replace(/^.*_/, '')} .${a.style_class ?? ''} "${textOf(a) ?? ''}" ${Math.round(w)}x${Math.round(h)} @${Math.round(x)},${Math.round(y)} [${font}] op=${a.opacity}`);
                    }
                } else if (op === 'panelboxes') {
                    const [W] = global.display.get_size();
                    const rects = Main.panel._rightBox.get_children().filter(c => c.visible).map(c => {
                        const [x, y] = c.get_transformed_position();
                        const [w, h] = c.get_transformed_size();
                        const child = c.get_first_child();
                        return {name: child?.constructor.name ?? '?', x: Math.round(x - (W - 460)), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
                    });
                    out(`panelboxes ${JSON.stringify(rects)}`);
                } else if (op === 'menutext') {
                    const texts = [...walk(ind.menu.actor)].filter(a => a.mapped).map(textOf).filter(t => t);
                    out(`menu-text ${JSON.stringify(texts)}`);
                }
            } catch (e) {
                out(`FAIL step ${op} ${arg}: ${e}`);
            }
        }
    }
}
