import * as RT from "runtypes";
import { buildLexer, rule, apply, seq, tok, alt_sc, list_sc, nil, kright, rep_sc, str, opt_sc, kleft, kmid, expectSingleResult, expectEOF } from "typescript-parsec";


const SectionDef = RT.Object({
    name: RT.String,
    type: RT.String,
    align: RT.Number
}).exact();
export type SectionDef = RT.Static<typeof SectionDef>;

const SplitUnit = RT.Object({
    name: RT.String,
    comment: RT.Number.optional(),
    order: RT.Number.optional()
}).exact();
export type SplitUnit = RT.Static<typeof SplitUnit>;

const SplitSection = RT.Object({
    name: RT.String,
    start: RT.Number,
    end: RT.Number,
    align: RT.Number.optional(),
    common: RT.Literal(true).optional(),
    rename: RT.String.optional(),
    skip: RT.Literal(true).optional()
}).exact().withConstraint(a => a.start <= a.end || `Invalid split range 0X${a.start.toString(16).toUpperCase()}..0X${a.end.toString(16).toUpperCase()}`);
export type SplitSection = RT.Static<typeof SplitSection>;

export type Split = {
    description: SplitUnit;
    sections: SplitSection[];
}

export type SplitsFile = {
    sections_descriptor: SectionDef[];
    splits: Split[];
}

export enum TokenKind {
    Newline,
    Comment,
    Sections,
    Whitespace,
    Number,
    IdentName,
    Text
}

export const tokenizer = buildLexer([
    [true, /^\r?\n/g, TokenKind.Newline],
    [true, /^(?:0[xX][0-9a-fA-F]+|\d+)/g, TokenKind.Number],
    [true, /^Sections:/g, TokenKind.Sections],
    [false, /^(?:[/][/]|#)[^\n]*\n/g, TokenKind.Comment],
    [true, /^[^ \r\n\t:]+:/g, TokenKind.IdentName],
    [true, /^[^ \r\n\t:]+/g, TokenKind.Text],
    [false, /^[ \t\r]+/g, TokenKind.Whitespace],
]);


export type Attribute = Record<string,string|number|true>;


export const SECTIONS_HEADER = rule<TokenKind, undefined>();
export const IDENTNAME = rule<TokenKind, string>();
export const NUMBER = rule<TokenKind, number>();
export const TEXT = rule<TokenKind, string>();
export const ATTRIBUTE = rule<TokenKind, Attribute>();
export const ENDLINE = rule<TokenKind,undefined>();
export const ATTRIBUTES = rule<TokenKind,Attribute>();
export const SECTION_DESC = rule<TokenKind,SectionDef>();
export const SECTIONS_DESC = rule<TokenKind,SectionDef[]>();
export const SPLITUNIT = rule<TokenKind,SplitUnit>();
export const SPLITSECTION = rule<TokenKind,SplitSection>();
export const SPLIT = rule<TokenKind,Split>();
export const SPLITSFILE = rule<TokenKind,SplitsFile>();


SECTIONS_HEADER.setPattern(apply(tok(TokenKind.Sections),_=>undefined));

IDENTNAME.setPattern(apply(tok(TokenKind.IdentName), token => token.text.slice(0, -1)));

NUMBER.setPattern(apply(tok(TokenKind.Number), token => +token.text));

TEXT.setPattern(apply(tok(TokenKind.Text), token => token.text));

ATTRIBUTE.setPattern(
    alt_sc(
        apply(seq(
            IDENTNAME,
            alt_sc(NUMBER, TEXT)
        ), value => { return { [value[0]]: value[1] }; }),
        apply(alt_sc(str('common'),str('skip')),value => {return {[value.text]: true};})
    )
);

ATTRIBUTES.setPattern(apply(list_sc(ATTRIBUTE,nil()),(attributes, tokens) => {
    return attributes.reduce((previous,current) => {
        let next = {...previous, ...current};
        if(Object.entries(current).length === Object.entries(next).length) {
            throw Error(`Duplicate entry '${Object.keys(previous)[0]}' at line ${tokens[0]?.pos.rowBegin}`);
        }
        return next;
    });
}));

SECTION_DESC.setPattern(
    apply(
        seq(TEXT,ATTRIBUTES),
        (a) => {
            return SectionDef.check({name:a[0], ...a[1]});
        }
    )
);

SECTIONS_DESC.setPattern(
    kright(seq(SECTIONS_HEADER,tok(TokenKind.Newline)),
        list_sc(SECTION_DESC,ENDLINE)
    )
);

ENDLINE.setPattern(apply(list_sc(tok(TokenKind.Newline),nil()),_ => undefined));

SPLITUNIT.setPattern(apply(seq(IDENTNAME,opt_sc(ATTRIBUTES)),(a) => {
    return SplitUnit.check({name:a[0],...a[1]});
}));

SPLITSECTION.setPattern(apply(
    seq(TEXT,ATTRIBUTES),
    (a) => {
        return SplitSection.check({name:a[0],...a[1]});
    }));

SPLIT.setPattern(apply(seq(kleft(SPLITUNIT,ENDLINE),list_sc(SPLITSECTION,ENDLINE)),
    a => {
        return {description:a[0],sections:a[1]};
    }
));

SPLITSFILE.setPattern(apply(
    kmid(
        opt_sc(ENDLINE),
        seq(
            kleft(SECTIONS_DESC,ENDLINE),
            list_sc(SPLIT,ENDLINE)
        ),
        opt_sc(ENDLINE)
    ),
    a => {
        return {sections_descriptor:a[0],splits:a[1]};
    }
));


export function ParseSplits(splits:string) {
    return expectSingleResult(expectEOF(SPLITSFILE.parse(tokenizer.parse(splits))));
}