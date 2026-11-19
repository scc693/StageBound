import test from 'node:test';
import assert from 'node:assert/strict';
import {flatten,weeks,progression,exerciseKey,monday,lbs} from '../src/trainingAnalytics.ts';
const workout={
 id:'w-1',title:'Pull',start_time:'2026-11-18T12:00:00-05:00',
 exercises:[{title:'Lat Pulldown',exercise_template_id:'lat-1',sets:[
  {type:'warmup',reps:10,weight_kg:30},
  {type:'normal',reps:10,weight_kg:60},
  {type:'normal',reps:8,weight_kg:65},
  {type:'dropset',reps:12,weight_kg:45},
  {type:'normal',reps:null,weight_kg:40}
 ]}]
};
test('original sets exclude warmups and no-rep sets, but include dropsets',()=>{
 const rows=flatten([workout]);assert.equal(rows.length,3);
 assert.deepEqual(rows.map(x=>x.reps),[10,8,12]);
 assert.equal(rows[1].weightKg,65);
 assert.equal(rows[2].type,'dropset');
});
test('reimported workouts do not inflate weekly set counts',()=>{
 const rows=flatten([workout,workout]);assert.equal(rows.length,3);
 const week=weeks([workout,workout],rows,[]);
 assert.equal(week.length,1);assert.equal(week[0].workouts,1);assert.equal(week[0].workingSets,3);assert.equal(week[0].unassignedSets,3);
});
test('unmapped sets never automatically count toward primary muscle totals',()=>{
 const rows=flatten([workout]);
 const mapping=[{exerciseKey:'hevy:lat-1',exerciseName:'Lat Pulldown',primaryMuscle:'Back',secondaryMuscle:'Biceps'}];
 const week=weeks([workout],rows,mapping);
 assert.equal(week[0].groups.Back,3);assert.equal(week[0].groups.Biceps||0,0);assert.equal(week[0].unassignedSets,0);
});
test('weeks start on Monday, including Sunday workout before Monday rollover',()=>{
 assert.equal(monday('2026-11-15'),'2026-11-09');
 assert.equal(monday('2026-11-16'),'2026-11-16');
});
test('progression uses top representative 1-10 rep set, not 12-rep drop-set for estimated max',()=>{
 const rows=flatten([workout]);
 const p=progression(rows,exerciseKey(workout.exercises[0]));
 assert.equal(p.length,1);assert.equal(p[0].reps,8);assert.equal(p[0].weightKg,65);
 assert.equal(Math.round(p[0].e1rmKg*10)/10,82.3);
 assert.equal(lbs(60),132.3);
});
test('duration-only exercises are not counted as hypertrophy sets',()=>{
 const x={id:'cardio',title:'Cardio',start_time:'2026-11-18T15:00:00-05:00',exercises:[{title:'Bike',sets:[{type:'normal',reps:null,duration_seconds:1200}]}]};
 assert.equal(flatten([x]).length,0);
});
