const { h } = Vue;

const App = {
    data() {
        return {
            // Initialize code with something useful
            code: `
function garbage(x, y) {
    return x + y;
}

if garbage(3, 4) != 10 {
    console.log("we're safe!")
} 
else {
    // cry
}
                `.trim(),
        }
    },

    template: `
            <textarea 
                v-model="code" 
                :rows="numberOfLines" 
                :cols="longestCodeLineLength">
            </textarea>
            <div class="char-area">
                <lexer-chars :charsSplitOnNewline="charsSplitOnNewline"></lexer-chars>
            </div>
        `,

    computed: {
        //
        // Lex textarea
        //
        longestCodeLineLength() {
            const lines = this.code.split('\n')
            let longest = ""
            for (line of lines) {
                if (line.length > longest.length) {
                    longest = line
                }
            }
            return longest.length
        },
        numberOfLines() {
            return this.code.split('\n').length
        },
        charsSplitOnNewline() {
            return this.code.split('\n').map(line => line.split(''))
        },
    }
}

const app = Vue.createApp(App)

// need to emit event or this is useless
// app.directive('get-height', (el, binding) => {
//     console.log(el);
//     console.log(binding);
// })

app.component('lexer-chars', {
    props: ['charsSplitOnNewline'],
    render() {
        let nodes = [];

        for (line of this.charsSplitOnNewline) {
            let row = []
            for (char of line) {
                if (char == ' ') {
                    row.push(h('div', { class: "space-char" }, "s"))
                } else {
                    row.push(h('div', char))
                }
            }

            nodes.push(h('div', { class: "row" }, row))
        }

        return h('div', { class: "lexer-chars" }, nodes)
    }
})


app.component('lexer-char', {
    props: ['char'],
    render() {
        if (this.char == '\s') {
            return h('div', "space")
        } else if (this.char == '\n') {
            return h('br')
        } else {
            return h('div', this.char)
        }
    }
})

app.mount('#app')
