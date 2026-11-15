import test from "node:test";
import assert from "node:assert/strict";
import {isDungeonXpEligible,relevantStats,rankFarmDungeons,rankInfo} from "./advisor.js";

test("XP filter requires at least five mobs and a strict majority above gray",()=>{
 assert.equal(isDungeonXpEligible([20,20,20,20],30),false);
 assert.equal(isDungeonXpEligible([23,23,23,23,23],30),true);
 assert.equal(isDungeonXpEligible([23,23,23,22,22],30),false);
});

test("healer stat display excludes damage-only stats",()=>{
 const stats=[{name:"Intellect",value:10},{name:"Spell Healing",value:12},{name:"Spell Damage",value:20},{name:"Spirit",value:5}];
 assert.deepEqual(relevantStats(stats,"Priest","Discipline"),["+10 Intellect","+12 Spell Healing","+5 Spirit"]);
});

test("caster stat display retains damage but not healing-only stats",()=>{
 const stats=[{name:"Intellect",value:10},{name:"Spell Healing",value:12},{name:"Spell Damage",value:20}];
 assert.deepEqual(relevantStats(stats,"Mage","Fire"),["+10 Intellect","+20 Spell Damage"]);
});

test("farm ranking uses measured run rates and limits output to logged dungeons",()=>{
 const input=[{name:"A",score:10},{name:"B",score:20}];
 const result=rankFarmDungeons(input,[{dungeon:"A",minutes:30,cloth:10,disenchantables:0}],{tailoring:true});
 assert.equal(result.rankings.length,1);
 assert.equal(result.rankings[0].name,"A");
 assert.equal(result.rankings[0].clothPerHour,20);
});

test("profession rank thresholds are stable",()=>{
 assert.equal(rankInfo(50).rank,"Journeyman");
 assert.equal(rankInfo(300).rank,"Artisan");
});
