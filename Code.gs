// 학생용 전용 Apps Script 프로젝트에서 사용하세요.
const SOURCE_ID = '1NwBGS57RtclvTyn2UJZNBCj6438JSaplq0N8o5mlWE8';
const CLASS_COLUMNS = {'1-1반':19,'1-2반':20,'1-3반':21,'2-1반':23,'2-2반':24,'2-3반':25,'3-1반':29,'3-2반':30,'3-3반':31};
function extractSchedule(rows, className) {
  const column = CLASS_COLUMNS[className];
  if (!column) throw new Error('유효한 학급을 선택해 주세요.');
  const schedule = Array.from({length:7},()=>Array(5).fill(''));
  const seen = new Set();
  let day = '';
  let matches = 0;
  for (const row of rows) {
    const label = String(row[15] == null ? '' : row[15]).trim();
    if (label) day = label.slice(0,1);
    const weekday = ['월','화','수','목','금'].indexOf(day);
    const period = Number(row[16]);
    if (weekday < 0 || !Number.isInteger(period) || period < 1 || period > 7) continue;
    const key = weekday + ':' + period;
    if (seen.has(key)) continue;
    seen.add(key);
    // Google Sheets TRIM처럼 공백을 정리하고 모든 쉼표를 줄바꿈으로 변환합니다.
    const text = String(row[column-1] == null ? '' : row[column-1]).trim().replace(/ +/g,' ').replace(/,/g,'\n');
    schedule[period-1][weekday] = text;
    if (text) matches++;
  }
  return {schedule, matches};
}
function doGet(e) {
  const params = e && e.parameter || {};
  const callback = String(params.callback || '');
  if (callback && !/^timetable_cb_\d+_\d+$/.test(callback)) return ContentService.createTextOutput('Invalid callback');
  let result;
  try {
    const className = String(params.className || '').trim();
    const sheetName = String(params.sheet || '').trim();
    if (!Object.prototype.hasOwnProperty.call(CLASS_COLUMNS,className)) throw new Error('학급을 선택해 주세요.');
    if (!/^\d{1,2}\/\d{1,2}~\d{1,2}\/\d{1,2}$/.test(sheetName)) throw new Error('주간 시트명을 확인해 주세요.');
    const sheet = SpreadsheetApp.openById(SOURCE_ID).getSheetByName(sheetName);
    if (!sheet) result = {ok:false,code:'SHEET_NOT_FOUND',message:'해당 주 시간표가 없습니다.'};
    else result = Object.assign({ok:true,className,sheetName},extractSchedule(sheet.getRange('A1:AI44').getDisplayValues(),className));
  } catch(error) {
    console.error(error);
    result = {ok:false,code:'READ_ERROR',message:'원본 조회에 실패했습니다. 학급, 시트명, 배포 계정의 원본 접근 권한을 확인하세요.'};
  }
  const json = JSON.stringify(result).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return ContentService.createTextOutput(callback ? callback+'('+json+');' : json).setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}
