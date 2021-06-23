const appEl = document.getElementById('app');

/// Ensures that data access has been properly subscribed to. Helps prevent bugs where we try to use
/// data from state that we didn't subscribe to but waste time figuring that out because `undefined`
/// can have multiple causes.
const getDataHandler = (fields) => ({
    get: function (self, field) {
        let isSubscribed = false;
        for (let subbedField of fields) {
            if (subbedField === field) {
                isSubscribed = true;
            }
        }

        if (!isSubscribed) {
            throw new Error(`you're not subscribed to the field '${field}, please subscribe before attempting to access it`)
        } else {
            return self[field];
        }
    }
});

/// When setting data in state, note that you must not do this inside of an update, as mutation can
/// lead to inconsistent states. But actually, I'm going to deep clone data, so this should not be
/// an issue, at cost of performance.
const state = {
    data: {
        lexingStarted: false,
        currentCharIndex: 0,
        tokenRules: [
            // {
            //     name: "identifier",
            //     process(str, start, cur) {
            //         let first = str[start];
            //         notWhitespace
            //     },
            //     matcher(chars) {
            //         return /^([a-zA-Z]|_)([a-zA-Z0-9_])*$/.test(chars);
            //     },
            //     examples: ['john', '_func', '_', 'John_Adams', 'FOOL', 'jim1_23', 'x1', 'y2']
            // }
        ],
        selectedCodeExample: 'default',
        // This will be a lookup table of all code examples. You can set a name and it will
        // auto-save when you select a new one. This let's you iteratively test.
        codeExamples: {
            default: `
function garbage(x, y) {
    return x + y;
}

if garbage(3, 4) != 10 {
    console.log("we're safe!")
} 
else {
    // cry
}`.trim(),
            "basic arithmetic": '3 + -5',
        },
    },

    /// Takes an object containing the fields you wish to update in the state along with their new
    /// values.
    setData(dataObj) {
        for (let field in dataObj) {
            this.data[field] = dataObj[field];
            this.changedFields.add(field);
        }
    },

    /// Accesses are the same as fields in terms of data access, however, they don't lead to a
    /// subscription effect when they change.
    setupDataForPassingToComponents(fields, accesses) {
        // Prepare to grab all fields + non-subscribed accesses from our state's data.
        fields = [...fields, ...accesses];

        // Do note that fields behind this proxy can still be mutated through methods (arrays, objects) and indexing.
        const dataProxy = new Proxy({}, {
            // Ensure only subscribed + fields are available, in addition to "accesses".
            get: (_self, field) => {
                let isSubscribed = false;
                // Verify that `field` is inside of the `fields` value above
                for (let subbedField of fields) {
                    if (subbedField === field) {
                        isSubscribed = true;
                    }
                }

                if (!isSubscribed) {
                    throw new Error(`you're not subscribed to the field '${field}, please subscribe (or place it in 'accesses') before attempting to access it`)
                } else {
                    return this.data[field];
                }
            },
            set: function () {
                throw new Error(`you shouldn't mutate state directly; use setData.`);
            }
        });
        return dataProxy;
    },

    /// Use this to set-up reactivity amongst your components. It will mount them all, using their
    /// mount code, and then update them when state changes are made. State is centralized here, and
    /// all changes propagate here.
    reactifyYourApp() {
        ///////////
        // Mount //
        ///////////
        for (let [component, fields, opts] of this.subscribedComponents) {
            // This proxy wrapping code should be the same as the update. So we'll likely want to
            // abstract the code out.
            const data = this.setupDataForPassingToComponents(fields, opts.accesses);

            component.data = data;
            component.mount({ data });
            component.mountAndUpdate && component.mountAndUpdate({ data });
        }

        ////////////////////
        // MountAndUpdate //
        ////////////////////

        // This is code that runs for *both* mount and update. The ordering is that it runs right
        // after initial mount, and then runs *before* every update. This is just because it
        // visually makes sense for this function to be sandwiched between mount and update, as
        // there are almost always things you only want to run on mount, and then run some
        // longer-living code after.

        // You'll notice that this code is merely added in the Mount and Update cycles. It's a
        // one-liner.

        ////////////
        // Update //
        ////////////
        const callback = () => {
            if (this.changedFields.size != 0) {
                // Iterate through all components that are subscribed and check to see if any of the
                // fields it subscribed to changed.
                let componentsToUpdate = [];
                for (let [component, fields, opts] of this.subscribedComponents) {
                    for (field of fields) {
                        if (this.changedFields.has(field)) {
                            // The component needs to be updated.

                            const data = this.setupDataForPassingToComponents(fields, opts.accesses);

                            // The update code itself might call setData, but because we only update
                            // components every animation frame, this should not result in any
                            // recursive issues.
                            //
                            // Actually though, because it mutates state, it may lead to
                            // inconsistent component state inter-this-loop. So we actually need to
                            // ensure setData doesn't alter state until we're ready. I think this is
                            // possible by delaying the component update to outside of this loop:
                            componentsToUpdate.push([component, data]);

                            // Exit this inner loop.
                            break;
                        }
                    }
                }

                // Now batch all the updates together at once. Ugh, the problem though still
                // remains: any mutation in an update will affect further updates. I can see why
                // React prefers immutability... yikes! But if we don't call setData in update code,
                // we'll be fine. So let's make that a restriction for now and see how that pans
                // out.
                //
                // Alternatively, (and I have indeed implemented this solution since documenting
                // here) since the central data that components use for updates is passed in to
                // them, if we make data a deep clone, then any mutation within a component won't
                // affect central state: only setData will affect central state. This *still* means
                // that central data can be changed by setData calls in update code, however, the
                // data being passed to each component will *not* be affected by those mutations,
                // because they are copies.
                //
                // Thus, components that don't access state.data directly use data that's fully
                // isolated from our central state, and only setData can change it, which we
                // metaphorically think of as sending a drone request to central state.
                //
                // It is important to note that a component *can* choose to update state internally
                // and not notify central. This is a bit problematic because no other components can
                // access such data in a reactive way, and further, DOM updates have to be handled
                // directly by the component. Even `update` won't work as intended, because it won't
                // have access to the `data` values and whatever else central state provides,
                // requiring manual passing of those values. Perhaps the "correct" way to do that in
                // those cases is to keep an internal buffer of the data stored every update, and
                // use that value in manual calls to update. As long as the synchronization code is
                // correct, that will ensure that the values are always up-to-date from central.
                for (let [component, data, _opts] of componentsToUpdate) {
                    component.data = data;
                    component.mountAndUpdate && component.mountAndUpdate({ data });
                    component.update && component.update({ data });
                }
                // Clear the set, as all fields have been changed.
                this.changedFields = new Set();
            } else {
                // Do nothing
            }

            // This triggers a loop of this function, but throttled to be only as fast as the DOM
            // can visually update. Infinite loops are possible, but will not gobble up all the CPU
            // because of this throttling. That said, I'm not sure how expensive doing things this
            // way will be; it might be worth cancelling the loop when there are no data changes
            // mid-loop, and wait for the next time setData is called to start up again.
            window.requestAnimationFrame(callback);
        };
        window.requestAnimationFrame(callback);
    },

    // A list of tuples with the component, the fields it's subscribed to, and additional options.
    subscribedComponents: [],
    changedFields: new Set(),

    subscribe(component, fields, opts = { accesses: [] }) {
        this.subscribedComponents.push([component, fields, opts]);
    }
};

function cloneDeep(data) {
    if (typeof data !== 'object') {
        return data;
    } else if (data.hasOwnProperty('length')) {
        // It's an array.
        let ret = [];
        for (let val of data) {
            ret.push(cloneDeep(val));
        }
        return ret;
    } else {
        // It's a normal object.
        let ret = {};
        for (let key in data) {
            let val = data[key];
            ret[key] = cloneDeep(val);
        }
        return ret;
    }
}

function TextArea() {
    function longestCodeLineLength(code) {
        const lines = code.split('\n');
        let longest = "";
        for (line of lines) {
            if (line.length > longest.length) {
                longest = line;
            }
        }
        return longest.length;
    }

    function numberOfLines(code) {
        return code.split('\n').length;
    }

    const obj = {
        mountNode: document.createElement('textarea'),
        mount() {
            const { selectedCodeExample, codeExamples } = this.data;
            const currentText = codeExamples[selectedCodeExample];

            this.updateTextArea(currentText);

            // When we update our textAreas here, we want to ensure that they update the state model.
            this.mountNode.addEventListener('keydown', e => this.updateTextArea(e.target.value, true));
            this.mountNode.addEventListener('keyup', e => this.updateTextArea(e.target.value, true));
            this.mountNode.addEventListener('keypress', e => this.updateTextArea(e.target.value, true));

            appEl.append(this.mountNode);
        },
        updateTextArea(currentText, setData) {
            this.mountNode.rows = numberOfLines(currentText) + 1;
            this.mountNode.cols = longestCodeLineLength(currentText) - 1;
            this.mountNode.textContent = currentText;
            if (setData) {
                state.setData({
                    codeExamples:
                        { ...this.data.codeExamples, [this.data.selectedCodeExample]: currentText }
                });
            }
        },
        update() {
            const { lexingStarted, codeExamples, selectedCodeExample } = this.data;
            this.updateTextArea(codeExamples[selectedCodeExample]);
            this.mountNode.disabled = lexingStarted;
        }
    };

    state.subscribe(obj, ['selectedCodeExample', 'codeExamples', 'lexingStarted']);
};

/// The id-generation code assumes only one character view exists at a time.
function CharacterView() {
    let charId = 0;

    // line: String
    // return: HTML
    function createLineOfChars(line, currentCharIndex) {
        let row = document.createElement('row');
        row.className = "row";

        for (char of line.split('')) {
            let div = document.createElement('div');
            div.innerHTML = char;
            div.className = "char";
            div.id = `char-${charId}`;

            if (char == ' ') {
                div.className += ' space';
            }

            if (charId === currentCharIndex) {
                div.className += ' selected';
            }

            row.append(div);
            charId += 1;
        }
        return row;
    }

    function buildCharacterView(code, currentCharIndex) {
        const container = document.createElement('div');
        container.id = 'character-view';
        container.className = 'character-view';
        for (line of code.split('\n')) {
            let row = createLineOfChars(line, currentCharIndex);
            container.append(row);
        }
        return container;
    }

    const obj = {
        mountNode: null,
        mount() {
            const { selectedCodeExample, codeExamples, currentCharIndex } = this.data;
            const container = buildCharacterView(codeExamples[selectedCodeExample], currentCharIndex);
            this.mountNode = container;
            appEl.append(this.mountNode);
        },
        // This does a full re-draw of every div, which is an expensive thing to do in the DOM
        // because new objects are created for each. But, it's a pain and the ass to do a more
        // granular update of this using just the textarea API, so we prefer this method for now.
        update() {
            charId = 0;
            const { selectedCodeExample, codeExamples, currentCharIndex } = this.data;
            const container = buildCharacterView(codeExamples[selectedCodeExample], currentCharIndex);
            this.mountNode.innerHTML = container.innerHTML;
        }
    };

    state.subscribe(obj, ['selectedCodeExample', 'currentCharIndex'], { accesses: ['codeExamples'] });
}

function NextChar() {
    // The current scheme is to create a new onClick function every update. An alternative would be
    // to query the *current* state in this function, meaning it would not have to be updated.
    //
    // However, I'd need to work out if that is actually safe. Currently, data is updated in a
    // regimented way, and components only access data they are subscribed to. This is probably a
    // good thing.

    currentListener = null;
    const obj = {
        mountNode: document.createElement('button'),
        mount() {
            const nextCharButton = this.mountNode;
            nextCharButton.innerHTML = "Next Char"
            appEl.append(this.mountNode);
        },
        mountAndUpdate({ data }) {
            this.mountNode.onclick = () => {
                let updated = { currentCharIndex: data.currentCharIndex + 1 };
                if (!data.lexingStarted) {
                    updated.lexingStarted = true;
                }
                state.setData(updated);
            }

            if (matchingRules(data.tokenRules).length === 0) {
                this.mountNode.title = 'the current character does not satisfy any rules';
                this.mountNode.disabled = true;
            } else {
                this.mountNode.title = null;
                this.mountNode.disabled = false;
            }
        }
    };

    state.subscribe(obj, ['currentCharIndex', 'lexingStarted', 'tokenRules']);
}

function ExampleSwitcher() {
    // implementation notes:

    // HTML Attributes don't support a lot of characters, so to use the value attribute we want to
    // preserve string uniqueness while using only supported chars. There is a way to do this:
    // base64 encoding is lossless, but it also uses some unsupported characters ('+' and '/' and
    // '='). Of these, string names don't seem to require '+' or '/', but '=' is used everywhere for
    // base64's padding. Solution: replace '=' with '-', which *is* compatible, and is not already
    // used by base64 encoding.

    function codeExamplesToDomOptions(examples, selectEl) {
        for (let key in examples) {
            let opt = document.createElement('option');
            opt.text = key;
            // See impl notes.
            opt.value = btoa(key).replace(/=/g, '-');

            let matchingOpt = selectEl.querySelector(`option[value=${opt.value}]`);
            // console.log(`matching opt`, matchingOpt);
            if (matchingOpt) {
                // Do nothing I guess? Options will *not* 
            } else {
                selectEl.add(opt);
            }
        }
    }

    const obj = {
        mountNode: document.createElement('div'),
        selectField: document.createElement('select'),
        mount() {
            this.mountNode.append(this.selectField);

            // Update the selected example in state on select-field change, clearing the current
            // lexing progress.
            this.selectField.onchange = (e) => {
                // See impl notes.
                const exampleName = atob(e.currentTarget.value.replace(/-/g, '='));
                state.setData({ selectedCodeExample: exampleName, lexingStarted: false, currentCharIndex: 0 });
            };

            appEl.append(this.mountNode);
        },
        mountAndUpdate() {
            codeExamplesToDomOptions(this.data.codeExamples, this.selectField);
        }
    };

    state.subscribe(obj, ['codeExamples'], { accesses: ['selectedCodeExample'] });
}

function RuleSpace() {
    const obj = {
        mountNode: document.createElement('div'),
        ruleArea: document.createElement('div'),
        mount() {
            const p = document.createElement('p');
            p.textContent = `
                Rulespace:
            `;
            this.mountNode.append(p);

            this.mountNode.append(this.ruleArea);

            appEl.append(this.mountNode);
        },
        mountAndUpdate() {
        },
        update() { },
    };

    state.subscribe(obj, []);
}

///////////
// Token //
///////////
function validateRuleExamples(tokenRule) {
    let failed;
    for (let example of tokenRule.examples) {
        if (!tokenRule.matcher(example)) {
            failed = example;
            break;
        }
    }
    if (failed) {
        return failed;
    } else {
        return true;
    }
}

function notWhitespace(str) {
    return !/\s+/s.test(str);
}

function matchingRules(rules, charBuffer) {
    let matches = [];
    for (rule of rules) {
        if (rule.matcher(charBuffer)) {
            matches.push(rule);
        }
    }
    return matches;
}

///////////////////////////
// New reactivity design //
///////////////////////////

// Lexing page:
ExampleSwitcher();
TextArea();
RuleSpace();
CharacterView();
NextChar();

// Begin app:
state.reactifyYourApp();

// Validate token examples for debugging:
for (let rule of state.data.tokenRules) {
    let res = validateRuleExamples(rule);
    if (res !== true) {
        console.log(`rule ${rule.name} failed on ${res}`);
    }
}
