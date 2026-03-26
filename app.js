import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

// Firebase Configuration (from user input)
const firebaseConfig = {
    apiKey: "AIzaSyAUErwacw_F8WoTbLSUzhlgB1FGmVDKF6U",
    authDomain: "free-consulting-48c22.firebaseapp.com",
    projectId: "free-consulting-48c22",
    storageBucket: "free-consulting-48c22.firebasestorage.app",
    messagingSenderId: "176522347764",
    appId: "1:176522347764:web:232967a29575d59eb4caa1",
    measurementId: "G-LB3DEHESR5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const INITIAL_DATA = {
    profile: {
        name: '', target: '', consultant: '', role: 'student',
        progress: {
            kor: { cur: 0, tot: 100, name: '국어' },
            math: { cur: 0, tot: 100, name: '수학' },
            eng: { cur: 0, tot: 100, name: '영어' },
            el1: { cur: 0, tot: 100, name: '탐구1' },
            el2: { cur: 0, tot: 100, name: '탐구2' }
        }
    },
    targetAnalysis: {
        univ: '', dept: '', status: 'none', reqKor: 0, reqMath: 0, reqEl: 0
    },
    exams: [], studies: [], advices: []
};

let currentUserUid = null;
let isAdmin = false;

const Store = {
    uid: null, // UID currently being viewed (Student)
    data: null, // Data of the UID currently being viewed
    init: async (targetUid) => {
        Store.uid = targetUid;
        const docRef = doc(db, "users", targetUid);
        const docSnap = await getDoc(docRef);
        if(docSnap.exists()) {
            Store.data = docSnap.data();
            if(!Store.data.advices) Store.data.advices = [];
            if(!Store.data.targetAnalysis) Store.data.targetAnalysis = { univ: '', dept: '', status: 'none', reqKor: 0, reqMath: 0, reqEl: 0 };
        } else {
            Store.data = INITIAL_DATA;
            try {
                await setDoc(docRef, Store.data);
            } catch(err) {
                console.warn("초기 데이터 생성 지연 (GCP 동기화 중):", err.message);
            }
        }
        Dashboard.refresh();
        App.populateForms();
    },
    getData: () => Store.data || INITIAL_DATA,
    saveData: async (newData) => {
        Store.data = newData;
        if(Store.uid) {
            try {
                await setDoc(doc(db, "users", Store.uid), newData);
            } catch (err) {
                console.error(err);
                alert("구글 클라우드 서버 동기화 지연으로 저장이 일시적으로 차단되었습니다. 최대 10~30분 뒤 새로고침 후 다시 시도해주세요!\n사유: " + err.message);
                return;
            }
        }
        Dashboard.refresh();
    }
}

// Global Auth State Observer
onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('main-app').style.display = 'flex';
        currentUserUid = user.uid;
        
        // Fetch to see my own role
        const docRef = doc(db, "users", currentUserUid);
        let mySnap = await getDoc(docRef);
        let myData = mySnap.exists() ? mySnap.data() : INITIAL_DATA;
        isAdmin = myData.profile && myData.profile.role === 'admin';
        
        if (isAdmin) {
            // Admin Mode: Show admin menus, list students
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
            App.switchToView('admin-view');
            AdminModule.loadStudents();
        } else {
            // Student Mode: Fetch own data and show dashboard
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            await Store.init(currentUserUid);
            App.switchToView('dashboard');
        }
    } else {
        document.getElementById('login-screen').classList.add('active');
        document.getElementById('main-app').style.display = 'none';
        Store.uid = null; Store.data = null; currentUserUid = null; isAdmin = false;
    }
});

const AdminModule = {
    loadStudents: async () => {
        const querySnapshot = await getDocs(collection(db, "users"));
        const tbody = document.getElementById('adminStudentTable');
        tbody.innerHTML = '';
        
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if(data.profile && data.profile.role === 'admin') return; // Hide admins from list
            
            const p = data.profile || {};
            const tAnalysis = data.targetAnalysis || {};
            const lastStudy = data.studies && data.studies.length > 0 
                ? data.studies[data.studies.length-1].date 
                : '<span style="color:var(--text-muted)">기록 없음</span>';
            
            // Pending request badge
            const pendingBadge = tAnalysis.status === 'waiting' 
                ? `<span style="display:inline-block; margin-right:8px; padding:3px 8px; font-size:0.75rem; background:#fee2e2; color:#ef4444; border-radius:12px; font-weight:700; animation:pulse-slow 2s infinite;">🔥 성적분석 요청</span>` 
                : '';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600;">${p.name || '이름 미설정'}</td>
                <td>${p.target || '-'}</td>
                <td>${p.consultant || '-'}</td>
                <td style="font-family:'JetBrains Mono';">${lastStudy}</td>
                <td style="text-align:right;">
                    ${pendingBadge}
                    <button class="btn-primary" style="margin:0; padding:6px 12px; font-size:0.8rem; width:auto; display:inline-block;">대시보드 접속</button>
                </td>
            `;
            const btn = tr.querySelector('button');
            btn.addEventListener('click', async () => {
                await Store.init(docSnap.id);
                App.switchToView('dashboard');
            });
            tbody.appendChild(tr);
        });
    }
};

let trendChartInst = null; let radarChartInst = null; let barChartInst = null;

const App = {
    init: () => {
        App.bindAuth();
        App.bindNavigation();
        App.bindForms();
        App.updateDateDisplay();
    },

    switchToView: (targetId) => {
        document.querySelectorAll('.nav-btn[data-target]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.nav-btn[data-target="${targetId}"]`);
        if(btn) btn.classList.add('active');
        
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const view = document.getElementById(targetId);
        if(view) view.classList.add('active');

        // If target is admin-view, reload list
        if(targetId === 'admin-view' && isAdmin) {
            AdminModule.loadStudents();
            document.getElementById('profileAdminLabel').style.display = 'none'; // reset label
            document.getElementById('profileName').innerText = "관리자 로비";
            document.getElementById('profileTarget').innerText = "-";
        }
    },

    bindAuth: () => {
        const errorEl = document.getElementById('authError');
        const showError = (msg) => { errorEl.style.display='block'; errorEl.innerText = msg; };

        document.getElementById('authForm').addEventListener('submit', async (e) => {
            e.preventDefault(); errorEl.style.display='none';
            const email = document.getElementById('authEmail').value;
            const pass = document.getElementById('authPassword').value;
            try { await signInWithEmailAndPassword(auth, email, pass); }
            catch(err) { showError("로그인 오류: " + err.message); }
        });

        document.getElementById('signupBtn').addEventListener('click', async () => {
            errorEl.style.display='none';
            const email = document.getElementById('authEmail').value;
            const pass = document.getElementById('authPassword').value;
            const makeAdmin = document.getElementById('authIsAdmin').checked;
            
            if(!email || pass.length < 6) return showError("올바른 이메일과 6자리 이상 비밀번호를 입력해주세요.");
            
            // 보안 모듈: 관리자 가입 시 권한 상승(Admin Escalation) 방지 비밀번호
            if(makeAdmin) {
                const secret = prompt("원장님 인증용 보안 [승인 코드]를 입력해 주세요.");
                if(secret !== "frere0915") {
                    document.getElementById('authIsAdmin').checked = false;
                    return showError("관리자 승인 코드가 일치하지 않습니다. 일반 학생이시라면 체크박스를 풀고 가입해 주세요.");
                }
            }

            try { 
                const cred = await createUserWithEmailAndPassword(auth, email, pass); 
                const initial = JSON.parse(JSON.stringify(INITIAL_DATA));
                if(makeAdmin) {
                    initial.profile.role = 'admin';
                    initial.profile.name = '프레르 담당 컨설턴트';
                }
                await setDoc(doc(db, "users", cred.user.uid), initial);
                
                alert(makeAdmin ? "🎊 학원 마스터 관리자 계정 생성 완료! 전체 명부가 준비되었습니다." : "학생 계정 신규 가입 완료!");
            } catch(err) { showError("가입 오류: " + err.message); }
        });

        document.getElementById('logoutBtn').addEventListener('click', () => { signOut(auth); });
    },

    populateForms: () => {
        const data = Store.getData();
        document.getElementById('setStudentName').value = data.profile.name || '';
        document.getElementById('setTargetUniv').value = data.profile.target || '';
        document.getElementById('setConsultant').value = data.profile.consultant || '';
        
        const p = data.profile.progress;
        document.getElementById('kCurr').value = p.kor.cur; document.getElementById('kTot').value = p.kor.tot;
        document.getElementById('mCurr').value = p.math.cur; document.getElementById('mTot').value = p.math.tot;
        document.getElementById('eCurr').value = p.eng.cur; document.getElementById('eTot').value = p.eng.tot;
        document.getElementById('t1Curr').value = p.el1.cur; document.getElementById('t1Tot').value = p.el1.tot;
        document.getElementById('t2Curr').value = p.el2.cur; document.getElementById('t2Tot').value = p.el2.tot;
        document.getElementById('examDate').valueAsDate = new Date();
        document.getElementById('studyDate').valueAsDate = new Date();
    },

    bindNavigation: () => {
        document.querySelectorAll('.nav-btn[data-target]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                App.switchToView(e.currentTarget.getAttribute('data-target'));
            });
        });
    },

    bindForms: () => {
        // Settings / Profile Form
        document.getElementById('settingsForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Store.getData();
            data.profile.name = document.getElementById('setStudentName').value;
            data.profile.target = document.getElementById('setTargetUniv').value;
            data.profile.consultant = document.getElementById('setConsultant').value;
            data.profile.progress = {
                kor: { cur: parseInt(document.getElementById('kCurr').value)||0, tot: parseInt(document.getElementById('kTot').value)||1, name: '국어' },
                math: { cur: parseInt(document.getElementById('mCurr').value)||0, tot: parseInt(document.getElementById('mTot').value)||1, name: '수학' },
                eng: { cur: parseInt(document.getElementById('eCurr').value)||0, tot: parseInt(document.getElementById('eTot').value)||1, name: '영어' },
                el1: { cur: parseInt(document.getElementById('t1Curr').value)||0, tot: parseInt(document.getElementById('t1Tot').value)||1, name: '탐구1' },
                el2: { cur: parseInt(document.getElementById('t2Curr').value)||0, tot: parseInt(document.getElementById('t2Tot').value)||1, name: '탐구2' }
            };
            await Store.saveData(data);
            alert('클라우드에 설정이 저장되었습니다.');
        });

        // Exam Data Form
        document.getElementById('examForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Store.getData();
            data.exams.push({
                date: document.getElementById('examDate').value,
                name: document.getElementById('examName').value,
                korPct: parseInt(document.getElementById('korPct').value) || 0,
                mathPct: parseInt(document.getElementById('mathPct').value) || 0,
                elPct: parseInt(document.getElementById('elPct').value) || 0
            });
            data.exams.sort((a,b) => new Date(a.date) - new Date(b.date));
            await Store.saveData(data);
            e.target.reset(); document.getElementById('examDate').valueAsDate = new Date();
            alert('모의고사 수치가 추가되었습니다.');
        });

        // Study Logs Form
        document.getElementById('studyForm').addEventListener('submit', async (e)=>{
            e.preventDefault();
            const data = Store.getData();
            const logDate = document.getElementById('studyDate').value;
            const studyLog = {
                date: logDate,
                kor: parseInt(document.getElementById('sKor').value) || 0,
                math: parseInt(document.getElementById('sMath').value) || 0,
                eng: parseInt(document.getElementById('sEng').value) || 0,
                el1: parseInt(document.getElementById('sEl1').value) || 0,
                el2: parseInt(document.getElementById('sEl2').value) || 0,
                sleep: parseFloat(document.getElementById('sSleep').value) || 0,
                lecture: parseInt(document.getElementById('sLecture').value) || 0,
                focus: parseInt(document.getElementById('sFocus').value) || 3
            };
            const existingIndex = data.studies.findIndex(s => s.date === logDate);
            if(existingIndex > -1) data.studies[existingIndex] = studyLog;
            else data.studies.push(studyLog);
            data.studies.sort((a,b) => new Date(a.date) - new Date(b.date));
            await Store.saveData(data);
            e.target.reset(); document.getElementById('studyDate').valueAsDate = new Date();
            alert('일급수치 기록이 저장되었습니다.');
        });

        // Advice Feedback Submission (Admin Only)
        document.getElementById('submitAdviceBtn')?.addEventListener('click', async () => {
            const inputEl = document.getElementById('adviceInput');
            const text = inputEl.value;
            if(!text.trim()) return;
            const data = Store.getData();
            if(!data.advices) data.advices = [];
            data.advices.push({
                date: new Date().toLocaleDateString('ko-KR'),
                text: text,
                author: '담당 컨설턴트'
            });
            await Store.saveData(data);
            inputEl.value = '';
            alert('학생 대시보드에 피드백 코멘트가 성공적으로 등록되었습니다!');
        });

        // Target University Analysis Request (Student)
        document.getElementById('targetUnivForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Store.getData();
            if(!data.targetAnalysis) data.targetAnalysis = { status: 'none', reqKor: 0, reqMath: 0, reqEl: 0 };
            data.targetAnalysis.univ = document.getElementById('stuHopeUniv').value;
            data.targetAnalysis.dept = document.getElementById('stuHopeDept').value;
            data.targetAnalysis.status = 'waiting';
            await Store.saveData(data);
            alert('프레르 프리즘 분석 요청이 전송되었습니다!');
        });

        // Target University Analysis Feedback (Admin)
        document.getElementById('targetAdminForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Store.getData();
            if(!data.targetAnalysis) data.targetAnalysis = { status: 'none' };
            data.targetAnalysis.reqKor = parseInt(document.getElementById('admReqKor').value) || 0;
            data.targetAnalysis.reqMath = parseInt(document.getElementById('admReqMath').value) || 0;
            data.targetAnalysis.reqEl = parseInt(document.getElementById('admReqEl').value) || 0;
            data.targetAnalysis.status = 'completed';
            await Store.saveData(data);
            alert('학생에게 목표 백분위 피드백이 전송되었습니다.');
        });
    },

    updateDateDisplay: () => {
        document.getElementById('currentDate').innerText = new Date().toLocaleDateString('ko-KR');
    }
}

const Dashboard = {
    refresh: () => {
        if(!Store.uid) return;
        const data = Store.getData();
        
        // Update Sidebar Profile
        document.getElementById('profileName').innerText = data.profile.name || "이름 미설정";
        document.getElementById('profileTarget').innerText = data.profile.target ? `목표: ${data.profile.target}` : '목표를 설정하세요';
        document.getElementById('profileConsultant').innerText = data.profile.consultant ? `담당: ${data.profile.consultant} 컨설턴트` : '';
        
        // Show Admin Indicator if an Admin is viewing a student
        if(isAdmin && Store.uid !== currentUserUid) {
            document.getElementById('profileAdminLabel').style.display = 'block';
            document.getElementById('adminAdvicePanel').style.display = 'block';
        } else {
            document.getElementById('profileAdminLabel').style.display = 'none';
            document.getElementById('adminAdvicePanel').style.display = 'none';
        }

        // Target Analysis View Update
        const tAnalysis = data.targetAnalysis || { status: 'none', univ: '', dept: '' };
        const targetStuForm = document.getElementById('targetStudentPanel');
        const targetLoading = document.getElementById('targetLoadingPanel');
        const targetResult = document.getElementById('targetResultPanel');
        const targetAdmForm = document.getElementById('targetAdminPanel');
        
        if (targetStuForm) {
            document.getElementById('stuHopeUniv').value = tAnalysis.univ || '';
            document.getElementById('stuHopeDept').value = tAnalysis.dept || '';
            
            if (tAnalysis.status === 'none') {
                targetLoading.style.display = 'none';
                targetResult.style.display = 'none';
            } else if (tAnalysis.status === 'waiting') {
                targetLoading.style.display = (isAdmin && Store.uid !== currentUserUid) ? 'none' : 'block';
                targetResult.style.display = 'none';
            } else if (tAnalysis.status === 'completed') {
                targetLoading.style.display = 'none';
                targetResult.style.display = 'block';
                document.getElementById('resReqKor').innerText = `${tAnalysis.reqKor}%`;
                document.getElementById('resReqMath').innerText = `${tAnalysis.reqMath}%`;
                document.getElementById('resReqEl').innerText = `${tAnalysis.reqEl}%`;
            }

            if (isAdmin && Store.uid !== currentUserUid) {
                if (tAnalysis.status === 'waiting' || tAnalysis.status === 'completed') {
                    targetAdmForm.style.display = 'block';
                    if(tAnalysis.status === 'completed') {
                        document.getElementById('admReqKor').value = tAnalysis.reqKor;
                        document.getElementById('admReqMath').value = tAnalysis.reqMath;
                        document.getElementById('admReqEl').value = tAnalysis.reqEl;
                    } else {
                        document.getElementById('admReqKor').value = '';
                        document.getElementById('admReqMath').value = '';
                        document.getElementById('admReqEl').value = '';
                    }
                } else {
                    targetAdmForm.style.display = 'none';
                }
            } else {
                targetAdmForm.style.display = 'none';
            }
        }

        // Render Accumulated Advices / Feedbacks
        const advices = data.advices || [];
        const advicePanel = document.getElementById('adviceListPanel');
        const adviceContainer = document.getElementById('adviceListContainer');
        if (advices.length > 0) {
            advicePanel.style.display = 'block';
            adviceContainer.innerHTML = '';
            [...advices].reverse().forEach(adv => {
                adviceContainer.innerHTML += `
                    <div style="padding:15px; background:rgba(217, 119, 6, 0.08); border-left:4px solid var(--accent-secondary); margin-bottom:12px; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.02);">
                        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; font-weight:600;">🗓 ${adv.date} | ✍️ ${adv.author}</div>
                        <div style="font-size:0.95rem; color:var(--text-main); line-height:1.4;">${adv.text}</div>
                    </div>
                `;
            });
        } else {
            advicePanel.style.display = 'none';
        }


        // Compute KPIs and Render Charts 
        const recentStudies = data.studies.slice(-7);
        let totalMins = 0, totalLec = 0, totalSleep = 0;
        recentStudies.forEach(s => {
            totalMins += (s.kor + s.math + s.eng + s.el1 + s.el2);
            totalLec += (s.lecture || 0);
            totalSleep += (s.sleep || 0);
        });

        const hours = Math.floor(totalMins / 60); const mins = totalMins % 60;
        document.getElementById('statStudyTime').innerText = `${hours}h ${mins}m`;
        const ratio = totalMins > 0 ? (totalLec / totalMins * 100).toFixed(1) : 0;
        document.getElementById('statLectureRatio').innerText = `${ratio}%`;
        const avgSleep = recentStudies.length > 0 ? (totalSleep / recentStudies.length).toFixed(1) : 0;
        document.getElementById('statSleep').innerText = `${avgSleep}h`;
        
        if(data.exams.length > 0) {
            const lastExp = data.exams[data.exams.length - 1];
            const avgPct = (lastExp.korPct + lastExp.mathPct + lastExp.elPct) / 3;
            document.getElementById('statExamAvg').innerText = `${avgPct.toFixed(1)}%`;
        } else {
            document.getElementById('statExamAvg').innerText = '-';
        }

        const pList = document.getElementById('progressList');
        pList.innerHTML = '';
        Object.values(data.profile.progress).forEach(subj => {
            const pct = Math.min(100, (subj.cur / subj.tot) * 100).toFixed(1);
            pList.innerHTML += `
                <div class="prog-item">
                    <div class="prog-info">
                        <span>${subj.name}</span>
                        <span class="prog-numbers">${subj.cur} / ${subj.tot} (${pct}%)</span>
                    </div>
                    <div class="prog-bar-bg"><div class="prog-bar-fill" style="width:${pct}%"></div></div>
                </div>
            `;
        });

        const logTable = document.getElementById('recentLogsTable');
        logTable.innerHTML = '';
        [...recentStudies].reverse().forEach(s => {
            const t = s.kor + s.math + s.eng + s.el1 + s.el2;
            logTable.innerHTML += `
                <tr>
                    <td>${s.date.slice(5)}</td>
                    <td style="color:var(--accent-secondary)">${t}분</td>
                    <td>${s.lecture || 0}분</td>
                    <td>${s.sleep || 0}</td>
                    <td>${s.focus}</td>
                </tr>
            `;
        });

        Charts.renderTrend(data.exams);
        Charts.renderRadar(recentStudies);
        Charts.renderBar(data.studies.slice(-7)); 
    }
};

const Charts = {
    initDefaults: () => {
        Chart.defaults.color = '#78716c';
        Chart.defaults.font.family = 'JetBrains Mono';
        Chart.defaults.plugins.legend.display = false;
    },
    renderTrend: (exams) => {
        Charts.initDefaults();
        const ctx = document.getElementById('trendChart').getContext('2d');
        if(trendChartInst) trendChartInst.destroy();
        trendChartInst = new Chart(ctx, {
            type: 'line',
            data: { labels: exams.map(e => e.date.slice(5)), datasets: [{ data: exams.map(e=>(e.korPct+e.mathPct+e.elPct)/3), borderColor: '#8b5a2b', fill: false, tension: 0.3 }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { suggestedMin: 50, suggestedMax: 100, display: true} }, plugins:{ tooltip:{callbacks:{label: c=>`평균 백분위: ${parseFloat(c.raw).toFixed(1)}%`}} } }
        });
    },

    renderRadar: (recentStudies) => {
        const ctx = document.getElementById('radarChart').getContext('2d');
        if(radarChartInst) radarChartInst.destroy();
        let sKor=0, sMath=0, sEng=0, sEl=0;
        recentStudies.forEach(s => { sKor+=s.kor; sMath+=s.math; sEng+=s.eng; sEl+=(s.el1+s.el2); });
        radarChartInst = new Chart(ctx, {
            type: 'radar',
            data: { labels: ['국', '수', '영', '탐'], datasets: [{ data: [sKor, sMath, sEng, sEl], borderColor: '#d97706', backgroundColor: 'rgba(217, 119, 6, 0.2)' }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { r: { angleLines: { color: 'rgba(0,0,0,0.05)' }, grid:{ color:'rgba(0,0,0,0.05)'}, ticks: { display: false } } } }
        });
    },

    renderBar: (studies) => {
        const ctx = document.getElementById('barChart').getContext('2d');
        if(barChartInst) barChartInst.destroy();
        barChartInst = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: studies.map(s => s.date.slice(5)),
                datasets: [
                    { type: 'line', data: studies.map(s => s.sleep||0), borderColor: '#d97706', tension: 0.3, yAxisID: 'y1' },
                    { type: 'bar', data: studies.map(s => s.kor+s.math+s.eng+s.el1+s.el2), backgroundColor: '#8b5a2b', borderRadius: 4, yAxisID: 'y' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { x: { grid: { display: false } }, y: { type: 'linear', position: 'left', grid: { color: 'rgba(0,0,0,0.05)' } }, y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, suggestedMin: 0, suggestedMax: 12 } }
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', App.init);
