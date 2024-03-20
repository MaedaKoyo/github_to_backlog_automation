var prop = PropertiesService.getScriptProperties().getProperties();

const APIKEY = prop.BACKLOG_API_KEY
const APIURL = 'https://hblab.backlogtool.com/api/v2/'
const PROJECT_ID = ''
const ISSUE_TYPE = ''
const HUONGPT1 = '' //backlog user id
const GITHUB_TOKEN = prop.GITHUB_TOKEN
const GITHUB_ACCOUNT = ''

//For google doc
//const doc = DocumentApp.openByUrl("");
//const BODY = doc.getBody();

//For google sheet
const SHEET_ID = '';
const SHEET_ISSUE = SpreadsheetApp.openById(SHEET_ID).getSheetByName('IssueId');
const SHEET_COMMENT = SpreadsheetApp.openById(SHEET_ID).getSheetByName('CommentId');


function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  //Logger.log(data)

  //HealthCheck
  if (data.healthcheck === 'true'){
    var result = {
      status: 'success'
    };
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  try{
    if (data.action === 'created' && data.issue) {//==========================[CREATE COMMENT]=============================
      let project_key = getProjectKey(data.issue.number);
      let content = getTranslatedContent(data.comment.body);
      let res = createComment(project_key, content);
      SHEET_COMMENT.appendRow([String(data.comment.id), String(res.id)]);

    }else if(data.action === 'edited' && data.issue){//==========================[UPDATE COMMENT]=============================
      if(data.comment){//normalコメント
        let content = getTranslatedContent(data.comment.body);
        let project_key = getProjectKey(data.issue.number);
        let backlog_comment_id = getBacklogCommentId(data.comment.id);
        updateComment(project_key, backlog_comment_id, content);
      }else{//issueコメント
        let project_key = getProjectKey(data.issue.number)
        let content = getTranslatedContent(data.issue.body)
        updateTicket(project_key, content);
      }

    }else if(data.action === 'deleted' && data.issue){//==========================[DELETE COMMENT]=============================
      if(!isRegisteredIssue(data.issue.number)){
        return;
      }

      let project_key = getProjectKey(data.issue.number)
      let backlog_comment_id = getBacklogCommentId(data.comment.id);
      deleteComment(project_key, backlog_comment_id)

      SHEET_COMMENT.deleteRow(findRow(SHEET_COMMENT, data.comment.id, 1))

    }else if(data.action === 'opened' && data.issue.assignees.length > 0){//======[CREATE ISSUE]================================
      if(!isAssigned(data.issue.assignees)){
        return;
      }
      create(data)

    }else if(data.action === 'assigned'){
      if(!isAssigned(data.issue.assignees)){
        return;
      }

      //open時にアサインされているとassignedも発火するため、sleepさせてデータがsheetに登録されるのを待つ
      Utilities.sleep(5000)
      if(isRegisteredIssue(data.issue.number)){
        return;
      }
      create(data)
      
      let project_key = getProjectKey(data.issue.number);
      let res = getGithubComments(data.issue.comments_url);
      res.forEach(function(comment){
        let content = getTranslatedContent(comment.body)
        let res_id = createComment(project_key, content);
        SHEET_COMMENT.appendRow([String(comment.id), String(res_id.id)]);
      })

    }else if(data.action === 'closed'){//======================================[CLOSE ISSUE]===================================
      try{
        if(data.pull_request){
          var project_key = getProjectKey(data.number)
        }else{
          var project_key = getProjectKey(data.issue.number);
        }
        closeTicket(project_key);
      }catch{
        return;
      }

    }else if(data.action === 'reopened' && data.issue){//=======================[REOPEN ISSUE]===================================
      if(!isRegisteredIssue(data.issue.number)){
        return;
      }

      let project_key = getProjectKey(data.issue.number);
      openTicket(project_key)

    }else if(data.action === 'review_requested'){//============================[Review Request]===================================
      // BODY.appendParagraph('====[Review Request]====');
      if(data.requested_reviewer.login != GITHUB_ACCOUNT){
        // BODY.appendParagraph(data.requested_reviewer.login)
        // BODY.appendParagraph('対象外')
        return;
      }
      create(data)

    }else{
      return;
    }
  } catch(e){
    return;
    //BODY.appendParagraph("[ERROR]===");
    //BODY.appendParagraph(e);
  }
}


//main CRUD func ==============================================================

function create(data){
  //get data
  if (data.action == 'review_requested'){
    var issue_number = String(data.number)
    var summary = '[REVIEW]#' + issue_number+ ' ' + data.pull_request.title
    var content = getTranslatedContent(data.pull_request.body)
  }else {
    var issue_number = String(data.issue.number)
    var summary = '#' + issue_number+ ' ' + data.issue.title
    var content = getTranslatedContent(data.issue.body)
  }

  //create backlog ticket
  let res = createTicket(summary, content);

  //insert data to sheet
  SHEET_ISSUE.appendRow([issue_number, String(res.issueKey)]);
}


//Util=========================================================================

//sheet内データ検索　　  col: number (Ex. A => 1)
function findRow(sheet,val,col){
  var dat = sheet.getDataRange().getValues()
  for(var i=1;i<dat.length;i++){
    if(dat[i][col-1] === val){
      return i+1;
    }
  }
  return 0;
}

function getGithubComments(url){
  let options = {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'Authorization': 'Bearer ' + GITHUB_TOKEN
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function getTranslatedContent(comment){
    let translated_message = LanguageApp.translate(comment, 'ja', 'vi');
    return comment + '\n\n**[Vietnamese]**\n' + translated_message;
}

function getProjectKey(git_issue_id){
  let search_value = 'B' + String(findRow(SHEET_ISSUE, git_issue_id, 1));
  let range = SHEET_ISSUE.getRange(search_value);
  return range.getValue()
}

function getBacklogCommentId(git_comment_id){
  search_value = 'B' + String(findRow(SHEET_COMMENT, git_comment_id, 1));
  range = SHEET_COMMENT.getRange(search_value);
  return range.getValue();
}

//check assign
function isAssigned(assignees){
  let is_assigned = false;
  assignees.forEach(function(member){
    if (member.login == GITHUB_ACCOUNT){
      is_assigned = true
    }
  });

  if(is_assigned){
    return true;
  }else{
    return false;
  }
}

//check is registered the issue
function isRegisteredIssue(git_issue_id){
  let search_value = findRow(SHEET_ISSUE, git_issue_id, 1);
  if (search_value == 0){
    return false;
  }else{
    return true
  }
}


//Backlog API ==================================================================
function createTicket(summary, content) {
  let url = APIURL + 'issues?' + 'apiKey=' + APIKEY;
  let options = {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'projectId': PROJECT_ID,
      'summary': summary,
      'issueTypeId': ISSUE_TYPE,
      'priorityId': '3',
      'description': content,
      'notifiedUserId[]': HUONGPT1
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function updateTicket(project_key, content) {
  let url = APIURL + 'issues/' + project_key +'?apiKey=' + APIKEY;
  let options = {
    method: 'PATCH',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'description': content
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function openTicket(project_key){
  let url = APIURL + 'issues/' + project_key +'?apiKey=' + APIKEY;
  let options = {
    method: 'PATCH',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'statusId': '1',
      'notifiedUserId[]': HUONGPT1
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function closeTicket(project_key){
  let url = APIURL + 'issues/' + project_key +'?apiKey=' + APIKEY;
  let options = {
    method: 'PATCH',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'statusId': '4',
      'notifiedUserId[]': HUONGPT1
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function createComment(project_key, content) {
  let url = APIURL + 'issues/' + project_key +'/comments?apiKey=' + APIKEY;
  let options = {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'content': content,
      'notifiedUserId[]': HUONGPT1
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function updateComment(project_key, backlog_comment_id, content) {
  let url = APIURL + 'issues/' + project_key + '/comments/' + backlog_comment_id +'?apiKey=' + APIKEY;
  let options = {
    method: 'PATCH',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    'payload': {
      'content': content
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}

function deleteComment(project_key, backlog_comment_id){
  let url = APIURL + 'issues/' + project_key + '/comments/' + backlog_comment_id +'?apiKey=' + APIKEY;
  let options = {
    method: 'DELETE',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    }
  };
  return JSON.parse(UrlFetchApp.fetch(url, options).getContentText());
}























