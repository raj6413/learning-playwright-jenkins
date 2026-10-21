pipeline {
        agent {
            docker {
                image 'playwright-java:2.0'
                reuseNode true
            }
        }
        tools {
            nodejs 'node20'
        }
    options {
        timeout(
        time: 30,
        unit: 'MINUTES'
    )
        buildDiscarder(
        logRotator(
            numToKeepStr: '20'
        )
    )
    }
        parameters {
            string(
        name: 'BROWSERS',
        defaultValue: 'chromium',
        description: 'Comma separated browsers. Example: chromium,firefox'
    )

            string(
        name: 'SUITES',
        defaultValue: 'smoke',
        description: 'Example: smoke,regression'
    )

        choice(
                name: 'ENV',
                choices: ['dev', 'qa', 'prod'],
                description: 'Select Environment'
            )
        }

        environment {
            ENV = "${params.ENV}"
            SUITES = "${params.SUITES}"
            BROWSERS = "${params.BROWSERS}"
        }

        stages {
            stage('Use Credentials') {
            steps {
                withCredentials([
                usernamePassword(
                    credentialsId: 'qa-test',
                    usernameVariable: 'USERNAME',
                    passwordVariable: 'PASSWORD'
                )
            ]) {
                    sh '''
                    echo "Username: $USERNAME"
                    echo "Password length: ${#PASSWORD}"
                '''
            }
            }
            }
            stage('Checkout') {
                steps {
                    // git branch: 'main',
                    // url: 'https://github.com/rajatrc2042-lab/playwright-jenkins-docker.git'
                     checkout scm

                    script {
                    currentBuild.displayName =
         "#${env.BUILD_NUMBER} | ${params.BROWSERS} | ${params.ENV} | ${params.TAGS}"
                    }
                }
            }

            stage('Verify') {
                steps {
                    sh 'pwd'
                    sh 'ls -la'
                }
            }

            stage('Install') {
                steps {
                    retry(2) {
                    sh 'npm ci'
                    }
                }
            }
         stage('Run Tests') {
            steps {
                script {
                    echo "Browsers : ${BROWSERS}"
                    echo "Environment : ${ENV}"
                    echo "Suites : ${SUITES}"

                    def browserArgs = BROWSERS
                    .split(',')
                    .collect { "--project=${it.trim()}" }
                    .join(' ')

                    def grepPattern = SUITES
                    .split(',')
                    .collect { "@${it.trim()}" }
                    .join('|')

                    sh """
                    npx playwright test \
                    ${browserArgs} \
                    --grep "${grepPattern}"
                """
                }
            }
         }
        }

    post {
        success {
            echo 'Tests Passed'
        }

        failure {
            echo 'Tests Failed'
        }
        always {
            allure(
            includeProperties: false,
            jdk: '',
            results: [[path: 'allure-results']]
        )

            publishHTML(target: [
            allowMissing: false,
            alwaysLinkToLastBuild: true,
            keepAll: true,
            reportDir: 'playwright-report',
            reportFiles: 'index.html',
            reportName: 'Playwright HTML Report'
        ])

            archiveArtifacts(
            artifacts: 'playwright-report/**, test-results/**, allure-results/**',
            fingerprint: true
)

        // cleanWs()
        }
    }
}
