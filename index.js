const appEl = document.getElementById('app');

/// Ensures that data access has been properly subscribed to. Helps prevent bugs where we use data
/// from state that we didn't subscribed to but waste time figuring that out because `undefined` can
/// have multiple causes.
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
        code: `
function garbage(x, y) {
    return x + y;
}

if garbage(3, 4) != 10 {
    console.log("we're safe!")
} 
else {
    // cry
}`.trim(),

        lexingStarted: false,
        currentCharIndex: 0,
    },

    setData(obj) {
        let dataObj = obj;
        if (typeof obj === 'function') {
            // create the next data
            dataObj = obj(cloneDeep(this.data));
        }

        for (let field in dataObj) {
            this.data[field] = dataObj[field];
            this.changedFields.add(field);
        }
    },

    /// Use this to set-up reactivity amongst your components. It will mount them all, using their
    /// mount code, and then update them when state changes are made. State is centralized here, and
    /// all changes propagate here.
    reactifyYourApp() {
        ///////////
        // Mount //
        ///////////
        for (let [component, fields] of this.subscribedComponents) {
            // This proxy wrapping code should be the same as the update. So we'll likely want to
            // abstract the code out.
            let data = {};
            for (let field of fields) {
                data[field] = cloneDeep(this.data[field]);
            }
            data = new Proxy(data, getDataHandler(fields));

            component.mount({ data });
            component.mountAndUpdate && component.mountAndUpdate({ data });
        }

        ////////////////////
        // MountAndUpdate //
        ////////////////////

        // This is code that runs for *both* mount and update. The ordering is that it runs right
        // after initial mount, and then runs *before* every update. This is just because it
        // visually makes sense for this function to be sandwhiched between mount and update, as
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
                for (let [component, fields] of this.subscribedComponents) {
                    for (field of fields) {
                        if (this.changedFields.has(field)) {
                            // The component needs to be updated.

                            let data = {};
                            // Get the data for all the fields the component is subscribed to. We do
                            // a deep clone of each fetched field here, ensuring that any mutation
                            // doesn't alter the root state unless given as a return value in
                            // setData.
                            for (let field of fields) {
                                data[field] = cloneDeep(this.data[field]);
                            }
                            // Add get handlers for the data to ensure only subscribed fields are
                            // accessed.
                            data = new Proxy(data, getDataHandler(fields));

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
                // Alternatively, since we pass data in, if we make data a deep clone, then any
                // mutation won't affect it. I do this:
                for (let [component, data] of componentsToUpdate) {
                    component.mountAndUpdate && component.mountAndUpdate({ data });
                    component.update && component.update({ data });
                }
                // Clear the set, as all fields have been changed.
                this.changedFields = new Set();
            } else {
                // Do nothing
            }

            // This triggers a loop of this function. Not sure how expensive it will be?
            window.requestAnimationFrame(callback);
        };
        window.requestAnimationFrame(callback);
    },

    // A list of tuples with the component, and the fields it's subscribed to.
    subscribedComponents: [],
    changedFields: new Set(),

    subscribe(component, fields) {
        this.subscribedComponents.push([component, fields]);
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
    }
}

// Idea: use a Proxy wrapper around `data` with a getter, and make it throw an error if you access a
// field that doesn't exist in a state.

function TextArea() {
    const obj = {
        mountNode: null,
        mount({ data }) {
            const { code } = data;

            let currentText = code;
            let textarea = document.createElement('textarea');
            this.mountNode = textarea;
            textarea.textContent = currentText;
            this.updateTextArea(currentText);

            // When we update our textAreas here, we want to ensure that they update the state model.
            textarea.addEventListener('keydown', e => this.updateTextArea(e.target.value, true));
            textarea.addEventListener('keyup', e => this.updateTextArea(e.target.value, true));
            textarea.addEventListener('keypress', e => this.updateTextArea(e.target.value, true));

            appEl.append(textarea);
        },
        updateTextArea(currentText, setData) {
            this.mountNode.rows = numberOfLines(currentText) + 1;
            this.mountNode.cols = longestCodeLineLength(currentText) - 1;
            this.mountNode.textContent = currentText;
            if (setData) {
                state.setData({ code: currentText });
            }
        },
        update({ data }) {
            const { code, lexingStarted } = data;
            this.updateTextArea(code);
            if (lexingStarted) {
                this.mountNode.disabled = true;
            }
        }
    };

    state.subscribe(obj, ['code', 'lexingStarted']);
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
            charId += 1;

            if (char == ' ') {
                div.className += ' space';
            }

            if (charId === currentCharIndex) {
                div.className += ' selected';
            }

            row.append(div);
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
        mount({ data }) {
            const container = buildCharacterView(data.code, data.currentCharIndex);
            this.mountNode = container;
            appEl.append(this.mountNode);
        },
        // This does a full re-draw of every div, which is an expensive thing to do in the DOM
        // because new objects are created for each. But, it's a pain and the ass to do a more
        // granular update of this using just the textarea API, so we prefer this method for now.
        update({ data }) {
            charId = 0;
            this.mountNode.innerHTML = buildCharacterView(data.code, data.currentCharIndex).innerHTML;
        }
    };

    state.subscribe(obj, ['code', 'currentCharIndex']);
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
        mountNode: null,
        mount() {
            const nextCharButton = document.createElement('button');
            nextCharButton.innerHTML = "Next Char"
            this.mountNode = nextCharButton;
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
        }
    };

    state.subscribe(obj, ['currentCharIndex', 'lexingStarted']);
}

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


///////////////////////////
// New reactivity design //
///////////////////////////

// Lexing page:
TextArea();
CharacterView();
NextChar();

// Begin app:
state.reactifyYourApp();
