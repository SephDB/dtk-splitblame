import * as assert from 'assert';

import {TokenKind, tokenizer, IDENTNAME, ATTRIBUTE, ATTRIBUTES, SECTION_DESC, SECTIONS_DESC, ENDLINE, SECTIONS_HEADER, SPLITUNIT, SPLITSECTION, SPLIT, SPLITSFILE } from '../dtk-splits-parser';
import { expectEOF, expectSingleResult, Parser, Rule, seq, tok, Token } from 'typescript-parsec';

function testParse<Output>(parser: Rule<TokenKind,Output> | Parser<TokenKind,Output>, input: string): Output {
    return expectSingleResult(expectEOF(parser.parse(tokenizer.parse(input))));
}


function testTokenizer(input: string, expecteds: [TokenKind, string][]): void {
  let token = tokenizer.parse(input);

  for (const expected of expecteds) {
    assert.notStrictEqual(token, undefined);
    token = <Token<TokenKind>>token;
    assert.strictEqual(token.kind, expected[0]);
    assert.strictEqual(token.text, expected[1]);
    token = token.next;
  }
  assert.strictEqual(token, undefined);
}

test(`Test tokenizer`, () => {
    testTokenizer("Sections:",[[TokenKind.Sections,'Sections:']]);
    testTokenizer(".text",[[TokenKind.Text,'.text']]);
    testTokenizer("text:",[[TokenKind.IdentName,'text:']]);
    testTokenizer("text:othertext", [[TokenKind.IdentName,'text:'],[TokenKind.Text,'othertext']]);
    testTokenizer("10",[[TokenKind.Number,'10']]);
    testTokenizer("0x80ab",[[TokenKind.Number,'0x80ab']]); 
    testTokenizer("name:0x80",[[TokenKind.IdentName,'name:'],[TokenKind.Number,'0x80']]);
    testTokenizer(`\n`,[[TokenKind.Newline,'\n']]);
    testTokenizer(`Sections:
     .text`,[[TokenKind.Sections,'Sections:'],[TokenKind.Newline,'\n'],[TokenKind.Text,'.text']]);
});

test(`Test single line parsers`, () => {
    assert.deepStrictEqual(testParse(IDENTNAME,"hello:"),"hello");
    assert.deepStrictEqual(testParse(ATTRIBUTE,"type:code"),{type:"code"});
    assert.deepStrictEqual(testParse(ATTRIBUTE,"start:0x80205CD0"),{start:0x80205CD0});
    assert.deepStrictEqual(testParse(ATTRIBUTE,"common"),{common:true});
    assert.deepStrictEqual(testParse(ATTRIBUTES,"start:0x80205CD0 end:0x80205EE0 align:16"), {start:0x80205CD0, end:0x80205EE0, align:16});
    assert.throws(() => testParse(ATTRIBUTES,"start:0x4 start:0x8"),{message:"Duplicate entry 'start' at line 1"});
    assert.deepStrictEqual(testParse(SECTION_DESC,"    .text   type:code align:8"),{name:".text",type:"code",align:8});
    assert.throws(() => testParse(SECTION_DESC,".text   typ:code align:8"));
    assert.throws(() => testParse(SECTION_DESC,"text   type:code align:8 test:blah"));

    assert.deepStrictEqual(testParse(SPLITUNIT,"revolution/base/PPCArch.c:"),{name:"revolution/base/PPCArch.c"});
    assert.deepStrictEqual(testParse(SPLITUNIT,"revolution/base/PPCArch.c: comment:8"),{name:"revolution/base/PPCArch.c",comment:8});
    assert.deepStrictEqual(testParse(SPLITSECTION,"    .text   start:0x80205CD0 end:0x80205E00 common align:8"),{name:".text",start:0x80205CD0,end:0x80205E00,common:true,align:8});
    assert.throws(() => testParse(SPLITSECTION,"    .text   start:0x90205CD0 end:0x80205E00"),{
      name:'ValidationError',
      message:"Constraint failed: Invalid split range 0X90205CD0..0X80205E00"
    });
});

test(`Test multiline parsers`, () => {
    assert.deepStrictEqual(testParse(ENDLINE,"\n    "),undefined);
    assert.deepStrictEqual(testParse(seq(SECTIONS_HEADER,ENDLINE),"Sections:\n"),[undefined,undefined]);
    const example = `Sections:
      .text    type:code align:8
      .data    type:data align:16`;
    assert.deepStrictEqual(testParse(SECTIONS_DESC,example),[{name:".text",type:"code",align:8},{name:".data",type:"data",align:16}]);
    const sectionExample = `revolution/base/PPCArch.c:
	.text       start:0x80205CD0 end:0x80205EE0 align:16
	.data       start:0x8033B5A8 end:0x8033B5E0`;
    assert.deepStrictEqual(testParse(SPLIT,sectionExample),{
      description: {name:'revolution/base/PPCArch.c'},
      sections: [
        {name:".text",start:0x80205CD0, end:0x80205EE0, align:16},
        {name:".data",start:0x8033B5A8, end:0x8033B5E0}
      ]
    });
    const full_example = example + '\n' + sectionExample;
    assert.deepStrictEqual(testParse(SPLITSFILE,full_example),{
      sections_descriptor: [{name:".text",type:"code",align:8},{name:".data",type:"data",align:16}],
      splits: [{
        description: {name:'revolution/base/PPCArch.c'},
        sections: [
          {name:".text",start:0x80205CD0, end:0x80205EE0, align:16},
          {name:".data",start:0x8033B5A8, end:0x8033B5E0}
        ]
      }]
    });
});
