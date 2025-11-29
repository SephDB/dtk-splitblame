import * as vscode from 'vscode';
import _ from 'lodash';
import { ParseSplits, SectionDef, SplitSection, SplitsFile } from './dtk-splits-parser';

export class SymbolManager {
    private decorationType: vscode.TextEditorDecorationType;
    private decorationRanges: vscode.DecorationOptions[];

    private active_mapping:readonly Set<vscode.Uri>[];
    private symbols:vscode.TextDocument;
    private parsed_symbols;
    private splits_uri:vscode.Uri;
    private splits:SplitsFile|undefined;
    private hovers:Map<number,vscode.MarkdownString>;

    private watcher:vscode.FileSystemWatcher;

    public constructor(symbols:vscode.TextDocument,splits_uri:vscode.Uri,active_mapping:readonly Set<vscode.Uri>[]) {
        this.symbols = symbols;
        this.splits_uri = splits_uri;
        this.active_mapping = active_mapping;
        this.decorationRanges = new Array();
        this.parsed_symbols = this.parseDoc();
        this.hovers = new Map();

        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(splits_uri,'*'));
        this.watcher.onDidChange(async e => {
            await this.updateSplits();
            vscode.window.visibleTextEditors.forEach(editor => {
                if(editor.document === this.symbols && this.active_mapping[editor.viewColumn!].has(this.symbols.uri)) {
                    this.open(editor);
                }
            });
        });
        
        this.decorationType = vscode.window.createTextEditorDecorationType({
            before: {
                color: new vscode.ThemeColor('editor.foreground'),
                height: 'editor.lineHeight',
                margin: '0 .5em 0 0',
                backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground')
            },
        });
    }

    public dispose() {
        this.watcher.dispose();
        this.decorationType.dispose();
    }

    private parseDoc() {
        const line_regex = /^\s*(?<name>[^\s=]+)\s*=\s*(?:(?<section>[A-Za-z0-9.]+):)?(?<addr>[0-9A-Fa-fXx]+);(?:\s*\/\/\s*(?<attrs>.*))?$/;
        const parsed = [];
        const errors = [];
        for(let line_index = 0; line_index < this.symbols.lineCount; ++line_index) {
            const line:vscode.TextLine = this.symbols.lineAt(line_index);
            const match = line.text.match(line_regex);
            if(match && match.groups) {
                parsed.push({line:line_index,name:match.groups.name,section:match.groups.section,address:+match.groups.addr});
            }
            else {
                if(!(line_index === this.symbols.lineCount-1 && line.text==="")) {
                    errors.push(line_index);
                }
            }
        }
        return {lines:parsed,errors:errors};
    }

    public static async Create(symbols:vscode.TextDocument, active_mapping:readonly Set<vscode.Uri>[]): Promise<SymbolManager> {
        const symbols_uri = symbols.uri;
        const splits_uri = symbols_uri.with({path:symbols_uri.path.replace('symbols.txt','splits.txt')});
        await vscode.workspace.fs.stat(splits_uri);

        const symbol = new SymbolManager(symbols,splits_uri,active_mapping);

        await symbol.updateSplits();

        return symbol;
    }

    public getHover(line:number) {
        return this.hovers.get(line);
    }

    private async updateSplits() {
        const readData = await vscode.workspace.fs.readFile(this.splits_uri);
        const readStr = Buffer.from(readData).toString('utf8');
        this.splits = ParseSplits(readStr);
        this.updateRanges();
    }

    public updateRanges() {
        if(this.splits === undefined) {return;}

        const symbols = this.getSymbolSplits();
        
        if(symbols === null) {return;}

        const {split_symbols,line_lookup} = symbols;

        const hovers = this.splits.splits.map(s => {
            let hover_text = `
### ${s.description.name}
---
`;
            const ret = new vscode.MarkdownString(hover_text);
            ret.isTrusted = true;

            s.sections.forEach(section => {
                let details = `**${section.name}**: 0x${section.start.toString(16).toUpperCase()}-0x${section.end.toString(16).toUpperCase()}`;
                const line = line_lookup.get(section);
                if(line !== undefined) {
                    const args = [{ lineNumber: line, at: 'center' }];
                    const commandUri = vscode.Uri.parse(
                    `command:revealLine?${encodeURIComponent(JSON.stringify(args))}`
                    );
                    details = `[${details}](${commandUri})`;
                }
                ret.appendMarkdown(`\n\n${details}`);
            });

            return ret;
        });

        const max_width = Math.max(7,...split_symbols.flatMap(split => split.split.name.length));
        
        const hover_lookup = new Map();

        let options:vscode.DecorationOptions[] = split_symbols.flatMap(({split,lines}) => lines.map(line => {
            const ret:vscode.DecorationOptions = {
                range: new vscode.Range(new vscode.Position(line.line, 0),new vscode.Position(line.line,0)),
                renderOptions: {
                    before: {
                        contentText: split.name.padEnd(max_width,'\u00A0'),
                    }
                }
            };
            if(split.split_index >= 0) {
                hover_lookup.set(line.line,hovers[split.split_index]);
            }
            return ret;
        }));

        options.push(...this.parsed_symbols.errors.map(n => {
            return {
                range: new vscode.Range(new vscode.Position(n, 0),new vscode.Position(n,0)),
                renderOptions: {
                    before: {contentText: "ERROR".padEnd(max_width,'\u00A0')}
                }
            };
        }));

        this.decorationRanges = options;
        this.hovers = hover_lookup;
    }


    private getSymbolSplits() {
        if(this.splits === undefined) {return null;}
        
        const friendly_name = (name:string) => {
            return name.substring(name.lastIndexOf('/')+1);
        };

        const line_lookup:Map<SplitSection,number> = new Map(); //section -> line number

        const linear_splits = this.splits.splits.flatMap((split,index) => split.sections.map(section => {
            return {name:friendly_name(split.description.name),split_index:index,section:section};
        }));
        
        const per_section = _.groupBy(linear_splits,s=>s.section.name);

        for(const section in per_section) {
            per_section[section].sort((a,b) => a.section.start - b.section.start);
            per_section[section].push({name:"",split_index:-1,section:{start:Infinity,end:Infinity,name:section}});
        }
        
        const split_symbols = [];
        
        let current_splits = [];
        let current_split = {name:"",split_index:-1,section:{start:0,end:0,name:""}};

        let current_lines:Array<typeof this.parsed_symbols.lines[0]> = [];

        this.parsed_symbols.lines.forEach(line => {
            if(line.address >= current_split.section.end || line.section !== current_split.section.name) {
                split_symbols.push({split:current_split,lines:current_lines});
                current_lines = [];

                if(line.section in per_section) {
                    current_splits = per_section[line.section];
                    while((current_split = current_splits.shift()!).section.end <= line.address) {}
                    if(current_split.section.start > line.address) {
                        current_splits.unshift(current_split);
                        current_split = {name:"",split_index:-1,section:{name:line.section,start:line.address,end:current_splits[0].section.start}};
                    }
                }
                else {
                    current_split = {name:"",split_index:-1,section:{name:line.section,start:line.address,end:Infinity}};
                }
                line_lookup.set(current_split.section,line.line);
            }
            current_lines.push(line);
        });
        split_symbols.push({split:current_split,lines:current_lines});

        return {split_symbols:split_symbols,line_lookup:line_lookup};
    }


    public open(editor:vscode.TextEditor) {
        editor.setDecorations(this.decorationType,this.decorationRanges);
    }

    public close(editor:vscode.TextEditor) {
        editor.setDecorations(this.decorationType,[]);
    }
}